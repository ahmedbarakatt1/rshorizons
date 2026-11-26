/** Generate an operator script, never run from a web build or application migration. */
export function supabaseSchedulerSql(origin:string,environment:"production"|"staging"):string {
  const url=new URL(origin);
  if(!["production","staging"].includes(environment)||url.protocol!=="https:"||origin!==url.origin||url.port||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname)||/^[\d.]+$/.test(url.hostname)||
    /(^|\.)(localhost|local|internal)$/i.test(url.hostname))throw new Error("Use the exact designated public HTTPS origin without a path, port, credentials, query or fragment.");
  const secretName=`rsh_${environment}_cron_secret`;
  const schedules=[["worker","* * * * *"],["monitor","*/5 * * * *"],["retention","30 2 * * *"]];
  const jobs=schedules.map(([name,schedule])=>`
DO $install$
DECLARE installed_job_id bigint;
BEGIN
  installed_job_id := cron.schedule('rsh-${environment}-${name}', '${schedule}', $request$
    SELECT net.http_get(
      url := '${url.origin}/api/internal/${name}',
      headers := jsonb_build_object('Authorization', 'Bearer ' ||
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${secretName}')),
      timeout_milliseconds := 300000
    );
  $request$);
  PERFORM cron.alter_job(job_id := installed_job_id, active := false);
END $install$;`).join("\n");
  return `-- Red Sea Horizons ${environment}: review the project and origin before executing.
-- No secret values are embedded. All three jobs are installed PAUSED atomically.
-- Reapplying intentionally pauses these named jobs; unrelated jobs are untouched.
BEGIN;
DO $check$
DECLARE role_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') OR
     NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') OR
     NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN
    RAISE EXCEPTION 'Enable pg_cron, pg_net and Vault in the designated Supabase project first';
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name='${secretName}' AND length(decrypted_secret)>=32) <> 1 THEN
    RAISE EXCEPTION 'Store the matching environment CRON_SECRET in the named Vault secret first';
  END IF;
  -- pg_net temporarily queues plaintext headers. Never expose that queue or Vault to app roles.
  FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','tourism_app') LOOP
    IF has_table_privilege(role_name,'net.http_request_queue','SELECT') OR
       has_table_privilege(role_name,'vault.decrypted_secrets','SELECT') THEN
      RAISE EXCEPTION 'Scheduler secret storage is readable by an application role; review privileges first';
    END IF;
  END LOOP;
END $check$;
${jobs}
COMMIT;
`;
}
