import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const EMPTY={artifacts:[],activity:[],stats:{uploads:0,dedupHits:0,verifications:0,deletes:0}};
export class JsonStore {
  constructor(file){this.file=file;this.state=structuredClone(EMPTY);this.queue=Promise.resolve();}
  async init(){await mkdir(dirname(this.file),{recursive:true});try{this.state=JSON.parse(await readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;await this.#persist();}return this;}
  snapshot(){return structuredClone(this.state);}
  async mutate(fn){const op=this.queue.then(async()=>{const draft=structuredClone(this.state);const result=await fn(draft);this.state=draft;await this.#persist();return result;});this.queue=op.catch(()=>{});return op;}
  async #persist(){const tmp=`${this.file}.${process.pid}.${Date.now()}.tmp`;await writeFile(tmp,JSON.stringify(this.state,null,2),{encoding:'utf8',mode:0o600});await rename(tmp,this.file);}
}
