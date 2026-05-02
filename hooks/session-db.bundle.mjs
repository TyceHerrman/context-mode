import{createRequire as I}from"node:module";import{existsSync as U,unlinkSync as v,renameSync as M}from"node:fs";import{tmpdir as x}from"node:os";import{join as F}from"node:path";var g=class{#t;constructor(t){this.#t=t}pragma(t){let e=this.#t.prepare(`PRAGMA ${t}`).all();if(!e||e.length===0)return;if(e.length>1)return e;let r=Object.values(e[0]);return r.length===1?r[0]:e[0]}exec(t){let s="",e=null;for(let o=0;o<t.length;o++){let a=t[o];if(e)s+=a,a===e&&(e=null);else if(a==="'"||a==='"')s+=a,e=a;else if(a===";"){let c=s.trim();c&&this.#t.prepare(c).run(),s=""}else s+=a}let r=s.trim();return r&&this.#t.prepare(r).run(),this}prepare(t){let s=this.#t.prepare(t);return{run:(...e)=>s.run(...e),get:(...e)=>{let r=s.get(...e);return r===null?void 0:r},all:(...e)=>s.all(...e),iterate:(...e)=>s.iterate(...e)}}transaction(t){return this.#t.transaction(t)}close(){this.#t.close()}},h=class{#t;constructor(t){this.#t=t}pragma(t){let e=this.#t.prepare(`PRAGMA ${t}`).all();if(!e||e.length===0)return;if(e.length>1)return e;let r=Object.values(e[0]);return r.length===1?r[0]:e[0]}exec(t){return this.#t.exec(t),this}prepare(t){let s=this.#t.prepare(t);return{run:(...e)=>s.run(...e),get:(...e)=>s.get(...e),all:(...e)=>s.all(...e),iterate:(...e)=>typeof s.iterate=="function"?s.iterate(...e):s.all(...e)[Symbol.iterator]()}}transaction(t){return(...s)=>{this.#t.exec("BEGIN");try{let e=t(...s);return this.#t.exec("COMMIT"),e}catch(e){throw this.#t.exec("ROLLBACK"),e}}}close(){this.#t.close()}},d=null;function B(){if(!d){let i=I(import.meta.url);if(globalThis.Bun){let t=i(["bun","sqlite"].join(":")).Database;d=function(e,r){let o=new t(e,{readonly:r?.readonly,create:!0}),a=new g(o);return r?.timeout&&a.pragma(`busy_timeout = ${r.timeout}`),a}}else if(process.platform==="linux")try{let{DatabaseSync:t}=i(["node","sqlite"].join(":"));d=function(e,r){let o=new t(e,{readOnly:r?.readonly??!1});return new h(o)}}catch{d=i("better-sqlite3")}else d=i("better-sqlite3")}return d}function b(i){i.pragma("journal_mode = WAL"),i.pragma("synchronous = NORMAL");try{i.pragma("mmap_size = 268435456")}catch{}}function N(i){if(!U(i))for(let t of["-wal","-shm"])try{v(i+t)}catch{}}function P(i){for(let t of["","-wal","-shm"])try{v(i+t)}catch{}}function y(i){try{i.pragma("wal_checkpoint(TRUNCATE)")}catch{}try{i.close()}catch{}}function C(i="context-mode"){return F(x(),`${i}-${process.pid}.db`)}function k(i,t=[100,500,2e3]){let s;for(let e=0;e<=t.length;e++)try{return i()}catch(r){let o=r instanceof Error?r.message:String(r);if(!o.includes("SQLITE_BUSY")&&!o.includes("database is locked"))throw r;if(s=r instanceof Error?r:new Error(o),e<t.length){let a=t[e],c=Date.now();for(;Date.now()-c<a;);}}throw new Error(`SQLITE_BUSY: database is locked after ${t.length} retries. Original error: ${s?.message}`)}function j(i){return i.includes("SQLITE_CORRUPT")||i.includes("SQLITE_NOTADB")||i.includes("database disk image is malformed")||i.includes("file is not a database")}function X(i){let t=Date.now();for(let s of["","-wal","-shm"])try{M(i+s,`${i}${s}.corrupt-${t}`)}catch{}}var m=Symbol.for("__context_mode_live_dbs__"),p=(()=>{let i=globalThis;return i[m]||(i[m]=new Set,process.on("exit",()=>{for(let t of i[m])y(t);i[m].clear()})),i[m]})(),T=class{#t;#e;constructor(t){let s=B();this.#t=t,N(t);let e;try{e=new s(t,{timeout:3e4}),b(e)}catch(r){let o=r instanceof Error?r.message:String(r);if(j(o)){X(t),N(t);try{e=new s(t,{timeout:3e4}),b(e)}catch(a){throw new Error(`Failed to create fresh DB after renaming corrupt file: ${a instanceof Error?a.message:String(a)}`)}}else throw r}this.#e=e,p.add(this.#e),this.initSchema(),this.prepareStatements()}get db(){return this.#e}get dbPath(){return this.#t}close(){p.delete(this.#e),y(this.#e)}withRetry(t){return k(t)}cleanup(){p.delete(this.#e),y(this.#e),P(this.#t)}};import{createHash as f}from"node:crypto";import{execFileSync as W}from"node:child_process";var l;function z(){let i=process.env.CONTEXT_MODE_SESSION_SUFFIX,t=process.cwd();if(l&&l.cwd===t&&l.envSuffix===i)return l.suffix;let s="";if(i!==void 0)s=i?`__${i}`:"";else try{let e=W("git",["worktree","list","--porcelain"],{encoding:"utf-8",timeout:2e3,stdio:["ignore","pipe","ignore"]}).split(/\r?\n/).find(r=>r.startsWith("worktree "))?.replace("worktree ","")?.trim();e&&t!==e&&(s=`__${f("sha256").update(t).digest("hex").slice(0,8)}`)}catch{}return l={cwd:t,envSuffix:i,suffix:s},s}function J(){l=void 0}var O=1e3,D=5,n={insertEvent:"insertEvent",getEvents:"getEvents",getEventsByType:"getEventsByType",getEventsByPriority:"getEventsByPriority",getEventsByTypeAndPriority:"getEventsByTypeAndPriority",getEventCount:"getEventCount",getLatestAttributedProject:"getLatestAttributedProject",checkDuplicate:"checkDuplicate",evictLowestPriority:"evictLowestPriority",updateMetaLastEvent:"updateMetaLastEvent",ensureSession:"ensureSession",getSessionStats:"getSessionStats",incrementCompactCount:"incrementCompactCount",upsertResume:"upsertResume",getResume:"getResume",markResumeConsumed:"markResumeConsumed",deleteEvents:"deleteEvents",deleteMeta:"deleteMeta",deleteResume:"deleteResume",getOldSessions:"getOldSessions",searchEvents:"searchEvents",incrementToolCall:"incrementToolCall",getToolCallTotals:"getToolCallTotals",getToolCallByTool:"getToolCallByTool"},A=class extends T{constructor(t){super(t?.dbPath??C("session"))}stmt(t){return this.stmts.get(t)}initSchema(){try{let s=this.db.pragma("table_xinfo(session_events)").find(e=>e.name==="data_hash");s&&s.hidden!==0&&this.db.exec("DROP TABLE session_events")}catch{}this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 2,
        data TEXT NOT NULL,
        project_dir TEXT NOT NULL DEFAULT '',
        attribution_source TEXT NOT NULL DEFAULT 'unknown',
        attribution_confidence REAL NOT NULL DEFAULT 0,
        source_hook TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        data_hash TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(session_id, type);
      CREATE INDEX IF NOT EXISTS idx_session_events_priority ON session_events(session_id, priority);

      CREATE TABLE IF NOT EXISTS session_meta (
        session_id TEXT PRIMARY KEY,
        project_dir TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_event_at TEXT,
        event_count INTEGER NOT NULL DEFAULT 0,
        compact_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_resume (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        snapshot TEXT NOT NULL,
        event_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        consumed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tool_calls (
        session_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        calls INTEGER NOT NULL DEFAULT 0,
        bytes_returned INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, tool)
      );

      CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    `);try{let t=this.db.pragma("table_xinfo(session_events)"),s=new Set(t.map(e=>e.name));s.has("project_dir")||this.db.exec("ALTER TABLE session_events ADD COLUMN project_dir TEXT NOT NULL DEFAULT ''"),s.has("attribution_source")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_source TEXT NOT NULL DEFAULT 'unknown'"),s.has("attribution_confidence")||this.db.exec("ALTER TABLE session_events ADD COLUMN attribution_confidence REAL NOT NULL DEFAULT 0"),this.db.exec("CREATE INDEX IF NOT EXISTS idx_session_events_project ON session_events(session_id, project_dir)")}catch{}}prepareStatements(){this.stmts=new Map;let t=(s,e)=>{this.stmts.set(s,this.db.prepare(e))};t(n.insertEvent,`INSERT INTO session_events (
         session_id, type, category, priority, data,
         project_dir, attribution_source, attribution_confidence,
         source_hook, data_hash
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),t(n.getEvents,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? ORDER BY id ASC LIMIT ?`),t(n.getEventsByType,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? ORDER BY id ASC LIMIT ?`),t(n.getEventsByPriority,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(n.getEventsByTypeAndPriority,`SELECT id, session_id, type, category, priority, data,
              project_dir, attribution_source, attribution_confidence,
              source_hook, created_at, data_hash
       FROM session_events WHERE session_id = ? AND type = ? AND priority >= ? ORDER BY id ASC LIMIT ?`),t(n.getEventCount,"SELECT COUNT(*) AS cnt FROM session_events WHERE session_id = ?"),t(n.getLatestAttributedProject,`SELECT project_dir
       FROM session_events
       WHERE session_id = ? AND project_dir != ''
       ORDER BY id DESC
       LIMIT 1`),t(n.checkDuplicate,`SELECT 1 FROM (
         SELECT type, data_hash FROM session_events
         WHERE session_id = ? ORDER BY id DESC LIMIT ?
       ) AS recent
       WHERE recent.type = ? AND recent.data_hash = ?
       LIMIT 1`),t(n.evictLowestPriority,`DELETE FROM session_events WHERE id = (
         SELECT id FROM session_events WHERE session_id = ?
         ORDER BY priority ASC, id ASC LIMIT 1
       )`),t(n.updateMetaLastEvent,`UPDATE session_meta
       SET last_event_at = datetime('now'), event_count = event_count + 1
       WHERE session_id = ?`),t(n.ensureSession,"INSERT OR IGNORE INTO session_meta (session_id, project_dir) VALUES (?, ?)"),t(n.getSessionStats,`SELECT session_id, project_dir, started_at, last_event_at, event_count, compact_count
       FROM session_meta WHERE session_id = ?`),t(n.incrementCompactCount,"UPDATE session_meta SET compact_count = compact_count + 1 WHERE session_id = ?"),t(n.upsertResume,`INSERT INTO session_resume (session_id, snapshot, event_count)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         snapshot = excluded.snapshot,
         event_count = excluded.event_count,
         created_at = datetime('now'),
         consumed = 0`),t(n.getResume,"SELECT snapshot, event_count, consumed FROM session_resume WHERE session_id = ?"),t(n.markResumeConsumed,"UPDATE session_resume SET consumed = 1 WHERE session_id = ?"),t(n.deleteEvents,"DELETE FROM session_events WHERE session_id = ?"),t(n.deleteMeta,"DELETE FROM session_meta WHERE session_id = ?"),t(n.deleteResume,"DELETE FROM session_resume WHERE session_id = ?"),t(n.searchEvents,`SELECT id, session_id, category, type, data, created_at
       FROM session_events
       WHERE project_dir = ?
         AND (data LIKE '%' || ? || '%' ESCAPE '\\' OR category LIKE '%' || ? || '%' ESCAPE '\\')
         AND (? IS NULL OR category = ?)
       ORDER BY id ASC
       LIMIT ?`),t(n.getOldSessions,"SELECT session_id FROM session_meta WHERE started_at < datetime('now', ? || ' days')"),t(n.incrementToolCall,`INSERT INTO tool_calls (session_id, tool, calls, bytes_returned)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(session_id, tool) DO UPDATE SET
         calls = calls + 1,
         bytes_returned = bytes_returned + excluded.bytes_returned,
         updated_at = datetime('now')`),t(n.getToolCallTotals,`SELECT COALESCE(SUM(calls), 0) AS calls,
              COALESCE(SUM(bytes_returned), 0) AS bytes_returned
       FROM tool_calls WHERE session_id = ?`),t(n.getToolCallByTool,`SELECT tool, calls, bytes_returned
       FROM tool_calls WHERE session_id = ? ORDER BY calls DESC`)}insertEvent(t,s,e="PostToolUse",r){let o=f("sha256").update(s.data).digest("hex").slice(0,16).toUpperCase(),a=String(r?.projectDir??s.project_dir??"").trim(),c=String(r?.source??s.attribution_source??"unknown"),u=Number(r?.confidence??s.attribution_confidence??0),_=Number.isFinite(u)?Math.max(0,Math.min(1,u)):0,E=this.db.transaction(()=>{if(this.stmt(n.checkDuplicate).get(t,D,s.type,o))return;this.stmt(n.getEventCount).get(t).cnt>=O&&this.stmt(n.evictLowestPriority).run(t),this.stmt(n.insertEvent).run(t,s.type,s.category,s.priority,s.data,a,c,_,e,o),this.stmt(n.updateMetaLastEvent).run(t)});this.withRetry(()=>E())}bulkInsertEvents(t,s,e="PostToolUse",r){if(!s||s.length===0)return;if(s.length===1){this.insertEvent(t,s[0],e,r?.[0]);return}let o=s.map((c,u)=>{let _=f("sha256").update(c.data).digest("hex").slice(0,16).toUpperCase(),E=r?.[u],S=String(E?.projectDir??c.project_dir??"").trim(),L=String(E?.source??c.attribution_source??"unknown"),R=Number(E?.confidence??c.attribution_confidence??0),w=Number.isFinite(R)?Math.max(0,Math.min(1,R)):0;return{event:c,dataHash:_,projectDir:S,attributionSource:L,attributionConfidence:w}}),a=this.db.transaction(()=>{let c=this.stmt(n.getEventCount).get(t).cnt;for(let u of o)this.stmt(n.checkDuplicate).get(t,D,u.event.type,u.dataHash)||(c>=O?this.stmt(n.evictLowestPriority).run(t):c++,this.stmt(n.insertEvent).run(t,u.event.type,u.event.category,u.event.priority,u.event.data,u.projectDir,u.attributionSource,u.attributionConfidence,e,u.dataHash));this.stmt(n.updateMetaLastEvent).run(t)});this.withRetry(()=>a())}getEvents(t,s){let e=s?.limit??1e3,r=s?.type,o=s?.minPriority;return r&&o!==void 0?this.stmt(n.getEventsByTypeAndPriority).all(t,r,o,e):r?this.stmt(n.getEventsByType).all(t,r,e):o!==void 0?this.stmt(n.getEventsByPriority).all(t,o,e):this.stmt(n.getEvents).all(t,e)}getEventCount(t){return this.stmt(n.getEventCount).get(t).cnt}getLatestAttributedProjectDir(t){return this.stmt(n.getLatestAttributedProject).get(t)?.project_dir||null}searchEvents(t,s,e,r){try{let o=t.replace(/[%_]/g,c=>"\\"+c),a=r??null;return this.stmt(n.searchEvents).all(e,o,o,a,a,s)}catch{return[]}}ensureSession(t,s){this.stmt(n.ensureSession).run(t,s)}getSessionStats(t){return this.stmt(n.getSessionStats).get(t)??null}incrementCompactCount(t){this.stmt(n.incrementCompactCount).run(t)}upsertResume(t,s,e){this.stmt(n.upsertResume).run(t,s,e??0)}getResume(t){return this.stmt(n.getResume).get(t)??null}markResumeConsumed(t){this.stmt(n.markResumeConsumed).run(t)}getLatestSessionId(){try{return this.db.prepare("SELECT session_id FROM session_meta ORDER BY started_at DESC LIMIT 1").get()?.session_id??null}catch{return null}}incrementToolCall(t,s,e=0){let r=Number.isFinite(e)&&e>0?Math.round(e):0;try{this.stmt(n.incrementToolCall).run(t,s,r)}catch{}}getToolCallStats(t){try{let s=this.stmt(n.getToolCallTotals).get(t),e=this.stmt(n.getToolCallByTool).all(t),r={};for(let o of e)r[o.tool]={calls:o.calls,bytesReturned:o.bytes_returned};return{totalCalls:s?.calls??0,totalBytesReturned:s?.bytes_returned??0,byTool:r}}catch{return{totalCalls:0,totalBytesReturned:0,byTool:{}}}}deleteSession(t){this.db.transaction(()=>{this.stmt(n.deleteEvents).run(t),this.stmt(n.deleteResume).run(t),this.stmt(n.deleteMeta).run(t)})()}cleanupOldSessions(t=7){let s=`-${t}`,e=this.stmt(n.getOldSessions).all(s);for(let{session_id:r}of e)this.deleteSession(r);return e.length}};export{A as SessionDB,J as _resetWorktreeSuffixCacheForTests,z as getWorktreeSuffix};
