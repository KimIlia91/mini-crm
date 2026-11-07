-- Status transitions via public.change_task_status: full matrix, comments, terminal state,
-- repeated requests, foreign/nonexistent tasks, anon.
begin;
create extension if not exists pgtap with schema extensions;
\ir ../helpers/auth.psql

select plan(45);

-- Fixtures (as postgres). Roles are changed by SQL under postgres, as in production.
select tests.create_user('tr-mgr-' || gen_random_uuid() || '@example.test') as mgr_id \gset
select tests.create_user('tr-exec-' || gen_random_uuid() || '@example.test') as exec_id \gset
select tests.create_user('tr-other-' || gen_random_uuid() || '@example.test') as other_id \gset
update public.profiles set role = 'manager' where id = :'mgr_id';
-- Simulate the mandatory first password change, so the users get effective roles.
update auth.users set encrypted_password = extensions.crypt('changed', extensions.gen_salt('bf'))
 where id in (:'mgr_id', :'exec_id', :'other_id');
insert into public.objects (name, address) values ('Transitions object', 'Addr') returning id as obj_id \gset

create temp table ctx as
select :'mgr_id'::uuid as mgr, :'exec_id'::uuid as assignee, :'other_id'::uuid as other, :'obj_id'::uuid as obj;

-- Function shape: public wrapper is SECURITY INVOKER, the implementation is DEFINER in private.
select is((select prosecdef from pg_proc where oid = 'public.change_task_status(uuid,public.task_status,text)'::regprocedure),
  false, 'public.change_task_status is security invoker');
select is((select prosecdef from pg_proc where oid = 'private.change_task_status(uuid,public.task_status,text)'::regprocedure),
  true, 'private.change_task_status is security definer');

-- Matrix: 5 from x 5 to x {manager, assignee executor, other executor}.
-- A rework comment is always supplied, so only the rule itself decides the outcome.
create temp table matrix_result (
  from_status text, to_status text, actor text, outcome text, state_ok boolean
);

do $$
declare
  c record;
  v_from public.task_status;
  v_to public.task_status;
  v_actor text;
  v_user uuid;
  v_task uuid;
  v_comment text;
  v_outcome text;
  v_status public.task_status;
  v_count int;
  v_last record;
  v_ok boolean;
begin
  select * into c from ctx;
  foreach v_from in array enum_range(null::public.task_status) loop
    foreach v_to in array enum_range(null::public.task_status) loop
      foreach v_actor in array array['manager', 'assignee', 'other_executor'] loop
        insert into public.tasks (object_id, title, assignee_id, author_id)
        values (c.obj, 'Matrix', c.assignee, c.mgr) returning id into v_task;
        update public.tasks set status = v_from where id = v_task;

        v_user := case v_actor when 'manager' then c.mgr when 'assignee' then c.assignee else c.other end;
        v_comment := case when v_to = 'rework' then 'Needs fixes' end;

        perform tests.authenticate_as(v_user);
        begin
          perform public.change_task_status(v_task, v_to, v_comment);
          v_outcome := 'ok';
        exception when others then
          v_outcome := sqlstate || ':' || sqlerrm;
        end;
        perform tests.clear_authentication();

        select status into v_status from public.tasks where id = v_task;
        select count(*) into v_count from public.task_status_history where task_id = v_task;
        select * into v_last from public.task_status_history where task_id = v_task order by id desc limit 1;

        if v_outcome = 'ok' then
          v_ok := v_status = v_to and v_count = 2
                  and v_last.from_status = v_from and v_last.to_status = v_to
                  and v_last.changed_by = v_user and v_last.comment is not distinct from v_comment;
        else
          -- rejected: no status change, only the initial (creation) history row
          v_ok := v_status = v_from and v_count = 1 and v_last.from_status is null;
        end if;

        insert into matrix_result values (v_from, v_to, v_actor, v_outcome, v_ok);
      end loop;
    end loop;
  end loop;
end;
$$;

-- Expected outcomes are written independently of public.task_transitions (spec table 2.3).
create temp table matrix_expected as
with allowed(from_status, to_status, actor) as (
  values ('new', 'in_progress', 'assignee'),
         ('in_progress', 'in_review', 'assignee'),
         ('in_review', 'accepted', 'manager'),
         ('in_review', 'rework', 'manager'),
         ('rework', 'in_progress', 'assignee')
)
select f.s as from_status, t.s as to_status, a.actor,
       case
         when a.actor = 'other_executor' then 'P0001:task_not_found'
         when exists (select 1 from allowed x where x.from_status = f.s and x.to_status = t.s and x.actor = a.actor)
           then 'ok'
         else 'P0001:transition_not_allowed'
       end as outcome
from unnest(enum_range(null::public.task_status)::text[]) f(s)
cross join unnest(enum_range(null::public.task_status)::text[]) t(s)
cross join unnest(array['manager', 'assignee', 'other_executor']) a(actor);

select is((select count(*)::int from matrix_result), 75, 'matrix covers 75 combinations');
select is_empty(
  $$ select r.from_status, r.to_status, r.actor, r.outcome, e.outcome as expected
       from matrix_result r
       join matrix_expected e using (from_status, to_status, actor)
      where r.outcome <> e.outcome $$,
  'matrix: every combination has the expected outcome'
);
select is_empty(
  $$ select from_status, to_status, actor, outcome from matrix_result where not state_ok $$,
  'matrix: success writes exactly one correct history row; rejection changes nothing'
);
select is((select count(*)::int from matrix_result where outcome = 'ok'), 5, 'exactly 5 combinations succeed');

-- Helper for the scenarios below: a fresh task in a given status.
create function pg_temp.task_in(p_status public.task_status) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.tasks (object_id, title, assignee_id, author_id)
  select obj, 'Scenario', assignee, mgr from ctx returning id into v_id;
  update public.tasks set status = p_status where id = v_id;
  return v_id;
end;
$$;

-- Rework requires a non-blank comment (null / '' / spaces), nothing changes on rejection.
select pg_temp.task_in('in_review') as rw_task \gset
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', null) $$, :'rw_task'),
  'P0001', 'comment_required', 'rework with null comment rejected');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', '') $$, :'rw_task'),
  'P0001', 'comment_required', 'rework with empty comment rejected');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', '   ') $$, :'rw_task'),
  'P0001', 'comment_required', 'rework with whitespace comment rejected');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', E'\t\n') $$, :'rw_task'),
  'P0001', 'comment_required', 'rework with tab/newline comment rejected');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', E'\n') $$, :'rw_task'),
  'P0001', 'comment_required', 'rework with newline comment rejected');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', E' \r\f\x0b\t ') $$, :'rw_task'),
  'P0001', 'comment_required', 'rework with CR/FF/VT comment rejected');
select throws_ok(format($$ select public.change_task_status(%L, 'rework') $$, :'rw_task'),
  'P0001', 'comment_required', 'rework with omitted comment rejected');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', %L) $$, :'rw_task', repeat('x', 1001)),
  '23514', null, 'rework comment > 1000 rejected');
select tests.clear_authentication();
select is((select status::text from public.tasks where id = :'rw_task'), 'in_review',
  'status unchanged after rejected rework');
select is((select count(*)::int from public.task_status_history where task_id = :'rw_task'), 1,
  'no history written by rejected rework');

-- Comment is trimmed and stored; 1000 chars is the boundary.
select tests.authenticate_as(:'mgr_id');
select lives_ok(format($$ select public.change_task_status(%L, 'rework', %L) $$, :'rw_task', E'\t Fix the wall\n\n'),
  'rework with comment succeeds');
select tests.clear_authentication();
select is((select comment from public.task_status_history where task_id = :'rw_task' order by id desc limit 1),
  'Fix the wall', 'comment is trimmed');
select is((select status::text from public.tasks where id = :'rw_task'), 'rework', 'status is rework');

select pg_temp.task_in('in_review') as rw2_task \gset
select tests.authenticate_as(:'mgr_id');
select lives_ok(format($$ select public.change_task_status(%L, 'rework', %L) $$, :'rw2_task', repeat('x', 1000)),
  'rework comment of 1000 chars accepted');
select tests.clear_authentication();

-- Optional comment on other transitions: blank becomes null, text is trimmed.
select pg_temp.task_in('new') as c_task \gset
select tests.authenticate_as(:'exec_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress', '   ') $$, :'c_task'),
  'blank optional comment accepted');
select lives_ok(format($$ select public.change_task_status(%L, 'in_review', ' done ') $$, :'c_task'),
  'optional comment accepted');
select tests.clear_authentication();
select results_eq(
  format($$ select from_status::text, to_status::text, comment from public.task_status_history
             where task_id = %L order by id $$, :'c_task'),
  $$ values (null::text, 'new', null::text), ('new', 'in_progress', null), ('in_progress', 'in_review', 'done') $$,
  'optional comments: blank stored as null, text trimmed'
);

-- Accepted is terminal for everyone.
select pg_temp.task_in('accepted') as acc_task \gset
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ select public.change_task_status(%L, 'rework', 'again') $$, :'acc_task'),
  'P0001', 'transition_not_allowed', 'manager cannot reopen an accepted task');
select tests.authenticate_as(:'exec_id');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'acc_task'),
  'P0001', 'transition_not_allowed', 'assignee cannot move an accepted task');
select tests.clear_authentication();

-- Repeated request (double click / retry) is rejected and does not duplicate history.
select pg_temp.task_in('new') as dup_task \gset
select tests.authenticate_as(:'exec_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'dup_task'), 'first request succeeds');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'dup_task'),
  'P0001', 'transition_not_allowed', 'repeated request rejected');
select tests.clear_authentication();
select is((select count(*)::int from public.task_status_history where task_id = :'dup_task'), 2,
  'repeated request writes no extra history');

-- Nonexistent / null task.
select pg_temp.task_in('new') as null_to_task \gset
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ select public.change_task_status(%L, 'accepted') $$, gen_random_uuid()),
  'P0001', 'task_not_found', 'nonexistent task (manager)');
select throws_ok($$ select public.change_task_status(null, 'accepted') $$,
  'P0001', 'task_not_found', 'null task id');
select tests.authenticate_as(:'exec_id');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, gen_random_uuid()),
  'P0001', 'task_not_found', 'nonexistent task (executor)');
-- Null target status matches no rule.
select throws_ok(format($$ select public.change_task_status(%L, null) $$, :'null_to_task'),
  'P0001', 'transition_not_allowed', 'null target status rejected');
select tests.clear_authentication();

-- Foreign task: indistinguishable from nonexistent for another executor.
select pg_temp.task_in('new') as foreign_task \gset
select tests.authenticate_as(:'other_id');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'foreign_task'),
  'P0001', 'task_not_found', 'other executor gets task_not_found');
select tests.clear_authentication();

-- Full lifecycle with a return to rework.
select pg_temp.task_in('new') as life_task \gset
select tests.authenticate_as(:'exec_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'life_task'), 'take into work');
select lives_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'life_task'), 'send to review');
select tests.authenticate_as(:'mgr_id');
select lives_ok(format($$ select public.change_task_status(%L, 'rework', 'Redo') $$, :'life_task'), 'return to rework');
select tests.authenticate_as(:'exec_id');
select lives_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'life_task'), 'take again');
select lives_ok(format($$ select public.change_task_status(%L, 'in_review') $$, :'life_task'), 'review again');
select tests.authenticate_as(:'mgr_id');
select lives_ok(format($$ select public.change_task_status(%L, 'accepted') $$, :'life_task'), 'accept');
select tests.clear_authentication();
select results_eq(
  format($$ select from_status::text, to_status::text, changed_by from public.task_status_history
             where task_id = %L order by id $$, :'life_task'),
  format($$ values (null::text, 'new', %1$L::uuid), ('new', 'in_progress', %2$L), ('in_progress', 'in_review', %2$L),
                   ('in_review', 'rework', %1$L), ('rework', 'in_progress', %2$L),
                   ('in_progress', 'in_review', %2$L), ('in_review', 'accepted', %1$L) $$, :'mgr_id', :'exec_id'),
  'lifecycle history is complete and ordered'
);

-- A soft-deleted task cannot change status (for anyone): task_not_found, nothing written.
select pg_temp.task_in('new') as del_new \gset
select pg_temp.task_in('in_review') as del_review \gset
update public.tasks set deleted_at = now(), deleted_by = :'mgr_id' where id in (:'del_new', :'del_review');
select tests.authenticate_as(:'exec_id');
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'del_new'),
  'P0001', 'task_not_found', 'assignee cannot move a deleted task');
select tests.authenticate_as(:'mgr_id');
select throws_ok(format($$ select public.change_task_status(%L, 'accepted') $$, :'del_review'),
  'P0001', 'task_not_found', 'manager cannot accept a deleted task');
select tests.clear_authentication();
select is((select array_agg(status::text order by status) from public.tasks where id in (:'del_new', :'del_review')),
  array['new', 'in_review'], 'deleted tasks keep their status');
select is((select count(*)::int from public.task_status_history where task_id in (:'del_new', :'del_review')), 2,
  'no history written for deleted tasks');

-- anon cannot execute the RPC at all.
select tests.authenticate_anon();
select throws_ok(format($$ select public.change_task_status(%L, 'in_progress') $$, :'life_task'),
  '42501', null, 'anon cannot execute change_task_status');
select tests.clear_authentication();

select * from finish();
rollback;
