-- Purge appointment rows independently once each row is at least seven days old.
-- Future appointments remain untouched unless their status is cancelled.
create extension if not exists pg_cron with schema pg_catalog;

create index if not exists appointments_created_at_idx
  on public.appointments (created_at);

do $migration$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'berber_cleanup_stale_appointments'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'berber_cleanup_stale_appointments',
    '0 * * * *',
    $cleanup$
      delete from public.appointments
      where created_at <= clock_timestamp() - interval '7 days'
        and (status = 'cancelled' or starts_at <= clock_timestamp());
    $cleanup$
  );
end;
$migration$;
