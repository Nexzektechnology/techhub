const {readFileSync,openSync,readSync,closeSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {isAbsolute}=require('node:path');
function targetHash(connectionString){const u=new URL(connectionString);return createHash('sha256').update(`${u.username}@${u.hostname}:${u.port||'5432'}${u.pathname}`).digest('hex');}
function backupHash(path){const fd=openSync(path,'r'),buffer=Buffer.alloc(1048576),hash=createHash('sha256');try{let count;while((count=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{closeSync(fd);}}
function validateEvidence(evidence,target,read=backupHash,now=Date.now()){
 if(!evidence||evidence.target_sha256!==target)throw Error('Backup evidence does not match this database target');
 const restored=Date.parse(evidence.restored_at);if(!Number.isFinite(restored)||restored>now||now-restored>86400000)throw Error('A successful isolated restore within the past 24 hours is required');
 for(const flag of ['restoration_verified','record_counts_verified','ownership_reviewed','rls_tests_passed','storage_backup_verified'])if(evidence[flag]!==true)throw Error(`Migration evidence missing: ${flag}`);
 if(typeof evidence.backup_file!=='string'||!isAbsolute(evidence.backup_file)||!/^[a-f0-9]{64}$/.test(evidence.backup_sha256||''))throw Error('An absolute database backup file and SHA-256 are required');
 const value=read(evidence.backup_file),hash=typeof value==='string'?value:createHash('sha256').update(value).digest('hex');if(hash!==evidence.backup_sha256)throw Error('Database backup checksum mismatch');
 return true;
}
function requireSaasEvidence(pending,connectionString,path,hasExistingTables){
 if(!hasExistingTables||!pending.some(m=>Number(m.name.slice(0,3))>=49))return;
 if(!path)throw Error('SaaS migrations require SAAS_MIGRATION_EVIDENCE; complete the backup/restore checklist first');
 let evidence;try{evidence=JSON.parse(readFileSync(path,'utf8'));}catch{throw Error('Migration evidence cannot be read');}
 validateEvidence(evidence,targetHash(connectionString));
}
module.exports={targetHash,validateEvidence,requireSaasEvidence};
