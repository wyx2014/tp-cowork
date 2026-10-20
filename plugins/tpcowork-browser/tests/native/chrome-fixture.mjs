import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const { importChromeBrowserData } = await import(new URL((process.env.BROWSER_TEST_LIB ?? '../../lib') + '/reference.js', import.meta.url));

// Only the external Chrome/Keychain inputs are fixtures; SQLite parsing, decryption,
// cookie mapping and the target Electron session are the production implementation.
export async function importFixture(directory, targetSession) {
  const profilePath = join(directory,'chrome-fixture');
  await mkdir(profilePath,{recursive:true});
  const db = new DatabaseSync(join(profilePath,'Cookies'));
  db.exec("CREATE TABLE meta(key TEXT,value TEXT); INSERT INTO meta VALUES('version','23'); CREATE TABLE cookies(host_key TEXT,name TEXT,path TEXT,expires_utc INTEGER,is_secure INTEGER,is_httponly INTEGER,samesite INTEGER,value TEXT,encrypted_value BLOB);");
  const cipher = createCipheriv('aes-128-cbc',pbkdf2Sync('fixture-secret','saltysalt',1003,16,'sha1'),Buffer.alloc(16,32));
  const encrypted=Buffer.concat([Buffer.from('v10'),cipher.update('imported-login'),cipher.final()]);
  db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?)').run('127.0.0.1','chrome_import','/',0,0,0,1,'',encrypted);
  db.close();
  return importChromeBrowserData({profilePath,platform:'darwin',targetSession,logger:{info(){},warn(){}},
    macChromeSafeStorageSecretReader:async()=> 'fixture-secret',
    localStorageImporter:async()=>({originsImported:0,entriesImported:0,originsSkipped:0,originsFailed:0}),
  });
}
