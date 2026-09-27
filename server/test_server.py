import json
import tempfile
import threading
import unittest
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
        self.event = {'title':'Тестовая встреча','category':'Встреча','description':'Тест API', 'place':'Корпус 6, аудитория 416','buildingId':'6','date':'2026-09-30','time':'16:00','endTime':'17:00'}
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
        self.assertStatus(403,lambda:self.call('POST','/v1/events',self.event))
        self.assertStatus(403,lambda:self.call('PATCH','/v1/users/'+self.member['user']['id']+'/role',{'role':'organizer'}))
        self.grant();eid=self.call('POST','/v1/events',self.event)['id']
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
        for change in [{'date':'2026-02-30'},{'endTime':'15:00'},{'buildingId':'999'},{'title':''}]:
            self.assertStatus(400,lambda:self.call('POST','/v1/events',{**self.event,**change}))
        self.call('POST','/v1/auth/logout')
        self.assertStatus(401,lambda:self.call('GET','/v1/auth/me'))
        self.assertStatus(401,lambda:self.db.login('member','wrong-password'))
    def test_http_json_and_static_file_boundary(self):
        server=make_server('127.0.0.1',0,self.db)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        base='http://127.0.0.1:'+str(server.server_address[1])
        try:
            with urlopen(base+'/v1/health') as response:self.assertEqual(json.load(response)['service'],'UUST Campus')
            with self.assertRaises(HTTPError) as result:urlopen(base+'/../server/server.py')
            self.assertEqual(result.exception.code,404)
            request=Request(base+'/v1/events',data=json.dumps(self.event).encode(),headers={'Content-Type':'application/json'},method='POST')
            with self.assertRaises(HTTPError) as result:urlopen(request)
            self.assertEqual(result.exception.code,401)
        finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
