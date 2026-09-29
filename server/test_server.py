import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from server import Store, APIError, make_server

class CommunityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Store(Path(self.temp.name) / 'test.sqlite')
        self.db.register({'username':'admin','name':'Admin','password':'test-admin-pass'}, role='admin')
        self.admin = self.db.login('admin','test-admin-pass')['token']
        self.member = self.db.dispatch('POST','/v1/auth/register',{'username':'member','name':'Участник','password':'test-user-pass','role':'admin'},'')
        self.event = {'title':'Тестовая встреча','category':'Встреча','description':'Тест API', 'place':'Корпус 6, аудитория 416','buildingId':'6','date':'2099-09-30','time':'16:00','endTime':'17:00'}
    def tearDown(self): self.temp.cleanup()
    def assertStatus(self, status, fn):
        with self.assertRaises(APIError) as result: fn()
        self.assertEqual(result.exception.status,status)
    def call(self, method,path,data=None,token=None):return self.db.dispatch(method,path,data or {},token or self.member['token'])
    def grant(self):self.call('PATCH','/v1/users/'+self.member['user']['id']+'/role',{'role':'organizer'},self.admin)
    def test_guest_can_read_but_cannot_publish(self):
        self.assertEqual(self.db.dispatch('GET','/v1/events',{},'')['events'],[])
        self.assertStatus(401,lambda:self.db.dispatch('POST','/v1/events',self.event,''))
    def test_role_cannot_be_self_assigned_and_permission_is_server_enforced(self):
        self.assertEqual(self.member['user']['role'],'user')
        self.assertStatus(403,lambda:self.call('POST','/v1/events',{**self.event,'kind':'official'}))
        self.assertStatus(403,lambda:self.call('PATCH','/v1/users/'+self.member['user']['id']+'/role',{'role':'organizer'}))
        self.grant();eid=self.call('POST','/v1/events',{**self.event,'kind':'official'})['id']
        public=self.db.dispatch('GET','/v1/events',{},'')['events']
        self.assertEqual(public[0]['id'],eid);self.assertEqual(public[0]['authorName'],'Участник')
        self.call('PATCH','/v1/users/'+self.member['user']['id']+'/role',{'role':'user'},self.admin)
        self.assertStatus(403,lambda:self.call('PATCH','/v1/events/'+eid,self.event))
    def test_ownership_admin_edit_delete_and_persistence(self):
        self.grant();eid=self.call('POST','/v1/events',self.event)['id']
        other=self.db.register({'username':'other','name':'Other','password':'test-other-pass'},role='organizer')
        token=self.db.login('other','test-other-pass')['token']
        self.assertStatus(403,lambda:self.call('DELETE','/v1/events/'+eid,{},token))
        self.call('PATCH','/v1/events/'+eid,{**self.event,'title':'Изменено'},self.admin)
        restarted=Store(self.db.path)
        self.assertEqual(restarted.dispatch('GET','/v1/events',{},'')['events'][0]['title'],'Изменено')
        self.call('DELETE','/v1/events/'+eid,{},self.admin)
        self.assertEqual(self.call('GET','/v1/events')['events'],[])
    def test_validation_and_revoked_sessions(self):
        self.grant()
        for change in [{'date':'2026-02-30'},{'endTime':'15:00'},{'buildingId':'999'},{'title':''},
                       {'capacity':0},{'capacity':True},{'capacity':1.5},{'capacity':'2'},{'kind':'admin'}]:
            self.assertStatus(400,lambda:self.call('POST','/v1/events',{**self.event,**change}))
        self.call('POST','/v1/auth/logout')
        self.assertStatus(401,lambda:self.call('GET','/v1/auth/me'))
        self.assertStatus(401,lambda:self.db.login('member','wrong-password'))
    def test_student_crud_and_untrusted_metadata(self):
        eid=self.call('POST','/v1/events',{**self.event,'authorId':'forged','attendeeCount':900,'viewerGoing':True})['id']
        row=self.call('GET','/v1/events')['events'][0]
        self.assertEqual((row['kind'],row['attendeeCount'],row['viewerGoing']),('student',0,False))
        self.assertEqual(row['authorId'],self.member['user']['id'])
        self.call('PATCH','/v1/events/'+eid,{**self.event,'title':'Своё событие'})
        self.assertStatus(403,lambda:self.call('PATCH','/v1/events/'+eid,{**self.event,'kind':'official'}))
        self.call('DELETE','/v1/events/'+eid)
    def test_attendance_idempotence_privacy_capacity_and_restart(self):
        eid=self.call('POST','/v1/events',{**self.event,'capacity':1})['id'];path='/v1/events/'+eid+'/attendance'
        self.assertStatus(401,lambda:self.db.dispatch('POST',path,{},''))
        for _ in range(2):
            row=self.call('POST',path)['event'];self.assertEqual(row['attendeeCount'],1);self.assertTrue(row['viewerGoing'])
        self.assertStatus(409,lambda:self.call('POST',path,{},self.admin))
        public=self.db.dispatch('GET','/v1/events',{},'')['events'][0]
        self.assertEqual(public['attendeeCount'],1);self.assertFalse(public['viewerGoing']);self.assertNotIn('attendees',public)
        restarted=Store(self.db.path)
        self.assertTrue(restarted.dispatch('GET','/v1/events',{},self.member['token'])['events'][0]['viewerGoing'])
        for _ in range(2):self.assertEqual(self.call('DELETE',path)['event']['attendeeCount'],0)
        self.call('POST',path,{},self.admin)
        self.call('DELETE','/v1/events/'+eid)
        with self.db.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM attendance').fetchone()[0],0)
    def test_last_seat_is_atomic_and_capacity_cannot_drop_below_attendance(self):
        eid=self.call('POST','/v1/events',{**self.event,'capacity':1})['id'];path='/v1/events/'+eid+'/attendance'
        def join(token):
            try:self.call('POST',path,{},token);return 200
            except APIError as e:return e.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(join,[self.admin,self.member['token']])),[200,409])
        self.call('PATCH','/v1/events/'+eid,{**self.event,'capacity':2})
        for token in (self.admin,self.member['token']):self.call('POST',path,{},token)
        self.assertStatus(409,lambda:self.call('PATCH','/v1/events/'+eid,{**self.event,'capacity':1}))
        self.assertEqual(self.call('GET','/v1/events')['events'][0]['attendeeCount'],2)
    def test_past_events_and_legacy_staff_events(self):
        eid=self.call('POST','/v1/events',{**self.event,'date':'2000-01-01'})['id']
        self.assertStatus(409,lambda:self.call('POST','/v1/events/'+eid+'/attendance'))
        with self.db.connect() as db:
            db.execute('UPDATE events SET payload=? WHERE id=?',(json.dumps(self.event),eid))
        self.assertEqual(self.call('GET','/v1/events')['events'][0]['kind'],'official')
        self.assertStatus(403,lambda:self.call('DELETE','/v1/events/'+eid))
    def test_http_json_and_static_file_boundary(self):
        server=make_server('127.0.0.1',0,self.db)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_address[1])
        try:
            with urlopen(base+'/v1/health') as response:self.assertEqual(json.load(response)['service'],'UUST Campus')
            with self.assertRaises(HTTPError) as result:urlopen(base+'/../server/server.py')
            self.assertEqual(result.exception.code,404)
            result.exception.close()
            request=Request(base+'/v1/events',data=json.dumps(self.event).encode(),headers={'Content-Type':'application/json'},method='POST')
            with self.assertRaises(HTTPError) as result:urlopen(request)
            self.assertEqual(result.exception.code,401)
            result.exception.close()
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
