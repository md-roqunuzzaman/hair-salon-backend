import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
const parse=file=>ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
const app=parse('src/app.ts'),imports=new Map(),mounts=[];
for(const s of app.statements)if(ts.isImportDeclaration(s)&&s.importClause?.namedBindings&&ts.isNamedImports(s.importClause.namedBindings))for(const e of s.importClause.namedBindings.elements)imports.set(e.name.text,path.resolve('src',s.moduleSpecifier.text.replace(/\.js$/,'.ts')));
const visit=(root,cb)=>{cb(root);ts.forEachChild(root,n=>visit(n,cb));};
visit(app,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(app)==='app'&&n.expression.name.text==='use'&&ts.isStringLiteral(n.arguments[0])&&n.arguments[1]&&imports.has(n.arguments[1].getText(app)))mounts.push([n.arguments[0].text,imports.get(n.arguments[1].getText(app))]);});
const inventory=[];
for(const [prefix,file]of mounts){const ast=parse(file);visit(ast,n=>{if(!ts.isCallExpression(n)||!ts.isPropertyAccessExpression(n.expression)||!['get','put','patch','post','delete'].includes(n.expression.name.text)||!ts.isStringLiteral(n.arguments[0]))return;const args=n.arguments.slice(1).map(a=>a.getText(ast));inventory.push({method:n.expression.name.text.toUpperCase(),path:prefix+n.arguments[0].text.replace(/^\/$/,''),middleware:args.slice(0,-1),controller:args.at(-1),source:path.relative(process.cwd(),file).replaceAll('\\','/'),requestContract:args.filter(a=>a.includes('Validation')||a.includes('validate')),responseContract:'Existing controller sendResponse envelope; controller/source retained as contract reference'});});}
visit(app,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(app)==='app'&&['get','post'].includes(n.expression.name.text)&&ts.isStringLiteral(n.arguments[0]))inventory.push({method:n.expression.name.text.toUpperCase(),path:n.arguments[0].text,middleware:n.arguments.slice(1,-1).map(a=>a.getText(app)),controller:n.arguments.at(-1).getText(app),source:'src/app.ts'});});
const baseline='docs/cancellation-refund-existing-routes.json';mkdirSync('docs',{recursive:true});
if (process.argv.includes('--audit')) {
  const old = JSON.parse(readFileSync(baseline));
  const differences = old.flatMap(r => {
    const now = inventory.filter(n=>n.method===r.method&&n.path===r.path);
    if(now.length!==1) return [{method:r.method,path:r.path,issue:'MISSING_OR_DUPLICATE',count:now.length}];
    if(JSON.stringify(now[0].middleware)!==JSON.stringify(r.middleware)||now[0].controller!==r.controller) return [{method:r.method,path:r.path,issue:'CONTRACT_CHANGED',before:r.middleware,after:now[0].middleware}];
    return [];
  });
  console.log(JSON.stringify(differences,null,2));
  if(differences.length) process.exitCode=1;
} else if (process.argv.includes('--baseline')) {
  if (existsSync(baseline)) throw Error('Baseline already exists; never overwrite it to hide removed routes');
  writeFileSync(baseline, JSON.stringify(inventory,null,2)+'\n');
  console.log(`Recorded ${inventory.length} existing routes`);
} else {
  const old = JSON.parse(readFileSync(baseline));
  // Explicitly approved 2026-10-28: preserve the current frontend/staff access.
  // Keep the historical baseline immutable; only this exact old/new contract
  // is accepted. Controller changes and every other middleware remain checked.
  const approvedStaffRead = {
    before: ['auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER)'],
    after: ['auth(Role.BRAND_OWNER, Role.BRANCH_MANAGER, Role.STAFF, Role.CUSTOMER)'],
  };
  let approvedUpdates = 0;
  let approvedRetirements = 0;
  let loginLimitsChecked = 0;
  let passwordChangeExceptionsChecked = 0;
  for (const r of old) {
    const now = inventory.filter(n=>n.method===r.method&&n.path===r.path);
    // User approved retaining automatic completion and keeping this manual route
    // disabled. Validate both its historical identity and its continued absence.
    if (r.method==='POST' && r.path==='/api/v1/appointments/:appointmentId/complete') {
      const before = ['auth(Role.STAFF, Role.BRANCH_MANAGER, Role.BRAND_OWNER)', 'validateRequest(appointmentValidation.completeAppointmentValidationSchema)'];
      if (now.length!==0 || r.controller!=='appointmentController.completeAppointment' || JSON.stringify(r.middleware)!==JSON.stringify(before)) throw Error('Approved manual completion retirement changed unexpectedly');
      approvedRetirements++;
      continue;
    }
    if (now.length!==1) throw Error(`Missing or duplicate existing route ${r.method} ${r.path}`);
    let expected = r.middleware;
    // Registration verification now includes the user-supplied abuse limit.
    // Preserve the old baseline and allow only this exact middleware addition.
    if (r.method==='POST' && r.path==='/api/v1/auth/register') {
      if(JSON.stringify(r.middleware)!==JSON.stringify(['validateRequest(authValidation.registerValidationSchema)']))throw Error('Registration baseline changed unexpectedly');
      expected=['validateRequest(authValidation.registerValidationSchema)','registrationRateLimit'];
    }
    // User-added login throttling: retain the historical baseline and require
    // exactly this security middleware after validation, with the same handler.
    if (r.method==='POST' && r.path==='/api/v1/auth/login') {
      if(JSON.stringify(r.middleware)!==JSON.stringify(['validateRequest(authValidation.LoginZodSchema)']))throw Error('Login baseline changed unexpectedly');
      expected=['validateRequest(authValidation.LoginZodSchema)','loginRateLimit'];
      loginLimitsChecked++;
    }
    // Current user-approved forced-password-change flow keeps only logout and
    // authenticated own-password changes accessible before the flag is cleared.
    if (r.method==='POST' && r.path==='/api/v1/auth/logout') {
      if(JSON.stringify(r.middleware)!==JSON.stringify(['auth()']))throw Error('Logout baseline changed unexpectedly');
      expected=['auth({ allowPasswordChangeRequired: true })'];
      passwordChangeExceptionsChecked++;
    }
    if (r.method==='PATCH' && r.path==='/api/v1/users/me/password') {
      if(JSON.stringify(r.middleware)!==JSON.stringify(['auth()','validateRequest(userValidation.changePasswordValidationSchema)']))throw Error('Password-change baseline changed unexpectedly');
      expected=['auth({ allowPasswordChangeRequired: true })','validateRequest(userValidation.changePasswordValidationSchema)'];
      passwordChangeExceptionsChecked++;
    }
    if (r.method==='GET' && r.path==='/api/v1/staff/:staffId') {
      if (JSON.stringify(r.middleware)!==JSON.stringify(approvedStaffRead.before)) throw Error('Staff baseline changed unexpectedly');
      expected = approvedStaffRead.after;
      approvedUpdates++;
    }
    // S7 changes only this debug log sink; preserve the historical baseline and
    // every other byte of middleware, auth/validation order and controller.
    if (r.method==='GET' && r.path==='/api/v1/branches/:branchId/appointments') {
      const before='console.log("URL:", req.originalUrl)';
      if (!r.middleware[0]?.includes(before)) throw Error('Branch logging baseline changed unexpectedly');
      expected=r.middleware.map((middleware,index)=>index===0?middleware.replace(before,'console.log("PATH:", req.path)'):middleware);
    }
    if (JSON.stringify(now[0].middleware)!==JSON.stringify(expected)||now[0].controller!==r.controller) throw Error(`Existing route middleware/controller changed: ${r.method} ${r.path}`);
  }
  if (approvedUpdates!==1) throw Error('Approved staff read contract was not checked');
  if (approvedRetirements!==1) throw Error('Approved manual completion retirement was not checked');
  if (loginLimitsChecked!==1) throw Error('Login rate-limit contract was not checked');
  if (passwordChangeExceptionsChecked!==2) throw Error('Required-password-change exceptions were not checked');
  const seen = new Set();
  for (const r of inventory) {
    const key = r.method+' '+r.path;
    if (seen.has(key)) throw Error('Duplicate route '+key);
    seen.add(key);
  }
  console.log(`${old.length} historical routes checked; ${approvedUpdates} approved contract update; ${approvedRetirements} approved retirement; login rate-limit contract checked; ${inventory.length-old.length+approvedRetirements} new routes; no method/path collisions`);
}
