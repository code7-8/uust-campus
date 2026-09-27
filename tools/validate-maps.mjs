import {readFileSync} from 'node:fs';
import {validateMapPack} from '../app/map/data.js';
const path=process.argv[2]||'app/data/maps.json';
try {
  const pack=JSON.parse(readFileSync(path,'utf8'));
  const {buildings}=JSON.parse(readFileSync(new URL('../app/data/buildings.json',import.meta.url),'utf8'));
  validateMapPack(pack,buildings,{allowSynthetic:process.argv.includes('--synthetic-test')});
  console.log(`OK: ${pack.dataVersion}; floors=${pack.floors.length}, places=${pack.locations.length}, edges=${pack.edges.length}${pack.synthetic?' [SYNTHETIC TEST ONLY]':''}`);
} catch(error) {console.error(error.message);process.exitCode=1;}
