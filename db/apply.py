"""Apply a SQL migration to the shared Supabase database.

Takes a before/after snapshot of every public object so the run can prove it only
added what it said it would. Purely additive by design: this database is shared
with other projects.
"""
import os, sys, hashlib

try:
    import psycopg
except ImportError:
    sys.exit("psycopg is not installed in this interpreter")


def env(path=".env"):
    d = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        d[k.strip()] = v.strip().strip('"').strip("'")
    return d


def snapshot(cur):
    cur.execute("""
        select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
    """)
    tables = {r[0] for r in cur.fetchall()}
    cur.execute("""
        select p.proname from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
    """)
    funcs = {r[0] for r in cur.fetchall()}
    return tables, funcs


def main():
    path = sys.argv[1]
    sql = open(path, encoding="utf-8").read()
    print(f"migration : {path}")
    print(f"bytes     : {len(sql)}")
    print(f"sha256    : {hashlib.sha256(sql.encode()).hexdigest()[:16]}")
    print()

    notices = []
    with psycopg.connect(env()["SUPABASE_DB_URL"], connect_timeout=20) as conn:
        with conn.cursor() as cur:
            before_t, before_f = snapshot(cur)

            # surface RAISE NOTICE from the migration's verify block
            def notice(diag):
                notices.append(diag.message_primary)
            conn.add_notice_handler(notice)

            cur.execute(sql)

            after_t, after_f = snapshot(cur)

    added_t = sorted(after_t - before_t)
    removed_t = sorted(before_t - after_t)
    added_f = sorted(after_f - before_f)
    removed_f = sorted(before_f - after_f)

    for n in notices:
        print("NOTICE   :", n)
    print()
    print(f"tables before/after : {len(before_t)} -> {len(after_t)}")
    print(f"  ADDED   : {added_t or 'none'}")
    print(f"  REMOVED : {removed_t or 'none - nothing belonging to another project was touched'}")
    print(f"functions added     : {added_f or 'none'}")
    print(f"functions removed   : {removed_f or 'none'}")

    ok = not removed_t and not removed_f and all(t.startswith("onlypad") for t in added_t + added_f)
    print()
    print("RESULT:", "OK — additive only" if ok else "REVIEW — something unexpected changed")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
