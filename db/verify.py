"""Exercise the onlypad_* schema against the real database.

Everything that writes runs inside a transaction that is ROLLED BACK, so the
board is left exactly as it was found. The point is to prove the constraints and
the record functions behave — not to seed data.
"""
import sys, json, urllib.request, urllib.error

try:
    import psycopg
except ImportError:
    sys.exit("psycopg is not installed")


def env(path=".env"):
    d = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        d[k.strip()] = v.strip().strip('"').strip("'")
    return d


E = env()
MINT = "So11111111111111111111111111111111111111112"   # a real 44-char base58 address
passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('  — ' + detail) if detail and not cond else ''}")


print("=== 1. validation must REFUSE bad input ===")

# Postgres resolves overloads by argument type, and a bare Python float arrives as
# double precision — which does NOT match a numeric parameter. Without these casts
# the call fails with 42883 "function does not exist", and a naive try/except reads
# that as a successful refusal. Every one of these tests was vacuous until the
# casts were added: the function was never being reached at all.
REC = ("select * from public.onlypad_record_coin("
       "%s::text,%s::text,%s::text,%s::text,%s::text,%s::text,%s::text,"
       "%s::text,%s::numeric,%s::text,%s::text,%s::text,%s::numeric)")

# SQLSTATEs that mean "the input was rejected", as opposed to "the call was wrong".
VALIDATION_STATES = {"22023", "23514", "23502", "23505"}


def sqlstate(exc):
    return getattr(getattr(exc, "diag", None), "sqlstate", None)


with psycopg.connect(E["SUPABASE_DB_URL"], connect_timeout=20) as conn:
    with conn.cursor() as cur:
        def expect_raise(label, sql, params):
            try:
                cur.execute("savepoint sp")
                cur.execute(sql, params)
                cur.execute("rollback to savepoint sp")
                check(label, False, "it was accepted")
            except psycopg.Error as e:
                cur.execute("rollback to savepoint sp")
                st = sqlstate(e)
                if st in VALIDATION_STATES:
                    check(label, True)
                else:
                    # 42883 here would mean the function was never reached, so the
                    # test proves nothing. Fail loudly instead of counting it.
                    check(label, False, f"wrong error {st}: {str(e).splitlines()[0][:90]}")

        base = [MINT, "Test Coin", "TEST", None, None, None, None, "stream", 0.60, "LauncherWa11et", "FeeWa11et", None, 0]

        expect_raise("cut_pct above 0.80 is refused", REC, base[:8] + [0.95] + base[9:])
        expect_raise("cut_pct below 0.40 is refused", REC, base[:8] + [0.10] + base[9:])
        expect_raise("unknown mode is refused",      REC, base[:7] + ["nonsense"] + base[8:])
        expect_raise("a 10-char 'mint' is refused",   REC, ["tooshort"] + base[1:])
        expect_raise("a blank name is refused",       REC, base[:1] + [""] + base[2:])
        expect_raise("a null cut_pct is refused",     REC, base[:8] + [None] + base[9:])

        # and the CHECK constraint on the table itself, bypassing the function
        try:
            cur.execute("savepoint sp2")
            cur.execute(
                "insert into public.onlypad_coins (mint,name,ticker,launcher_wallet,fee_wallet,cut_pct)"
                " values (%s,'X','X','L','F',0.95)", (MINT,))
            cur.execute("rollback to savepoint sp2")
            check("table CHECK refuses cut_pct 0.95 even via a raw insert", False, "it was accepted")
        except psycopg.Error:
            cur.execute("rollback to savepoint sp2")
            check("table CHECK refuses cut_pct 0.95 even via a raw insert", True)

        # a VERIFIED coin with no creator wallet must be impossible
        try:
            cur.execute("savepoint sp3")
            cur.execute(
                "insert into public.onlypad_coins (mint,name,ticker,launcher_wallet,fee_wallet,verified)"
                " values (%s,'X','X','L','F',true)", (MINT,))
            cur.execute("rollback to savepoint sp3")
            check("verified=true with no creator_wallet is refused", False, "it was accepted")
        except psycopg.Error:
            cur.execute("rollback to savepoint sp3")
            check("verified=true with no creator_wallet is refused", True)

        # psycopg3's `with conn:` COMMITS on clean exit. Relying on it to roll back
        # silently wrote a test coin into the live board the first time this ran.
        # Every write block below ends with an explicit rollback for that reason.
        conn.rollback()

print()
print("=== 2. the happy path (rolled back) ===")
with psycopg.connect(E["SUPABASE_DB_URL"], connect_timeout=20) as conn:
    with conn.cursor() as cur:
        cur.execute("select count(*) from public.onlypad_coins")
        before = cur.fetchone()[0]

        cur.execute(REC,
            (MINT, "Test Coin", "test", "a description", None, None, None,
             "stream", 0.60, "LauncherWa11et", "FeeWa11et", "sig123", 0.5))
        row = cur.fetchone()
        cols = [d.name for d in cur.description]
        rec = dict(zip(cols, row))
        check("record_coin returned a row", rec.get("mint") == MINT)
        check("first call reports inserted=true", rec.get("inserted") is True, str(rec))

        # idempotency: same mint again
        cur.execute(REC,
            (MINT, "Test Coin Renamed", "TEST", None, None, None, None,
             "stream", 0.60, "LauncherWa11et", "FeeWa11et", None, 0))
        rec2 = dict(zip([d.name for d in cur.description], cur.fetchone()))
        check("second call reports inserted=false (idempotent)", rec2.get("inserted") is False, str(rec2))

        cur.execute("select count(*) from public.onlypad_coins where mint=%s", (MINT,))
        check("exactly one row for the mint, not two", cur.fetchone()[0] == 1)

        cur.execute("select count(*) from public.onlypad_escrow where mint=%s", (MINT,))
        check("an escrow row was created with the coin", cur.fetchone()[0] == 1)

        cur.execute("select kind, payload->'split' from public.onlypad_events where mint=%s and kind='launch'", (MINT,))
        ev = cur.fetchone()
        check("a launch event was written", ev is not None)
        if ev:
            check("the launch event carries the split, not an amount",
                  ev[1] == {"cut": 60, "tips": 35, "pad": 5}, str(ev[1]))
        conn.rollback()

print()
print("=== 3. the copy rule, enforced in the database ===")
with psycopg.connect(E["SUPABASE_DB_URL"], connect_timeout=20) as conn:
    with conn.cursor() as cur:
        cur.execute(REC,
            (MINT, "Test Coin", "TEST", None, None, None, None,
             "stream", 0.60, "LauncherWa11et", "FeeWa11et", None, 0))
        try:
            cur.execute("savepoint s")
            cur.execute("select public.onlypad_record_event(%s::text,'cut','northstar','TEST',12.5::numeric,'@northstar',null)", (MINT,))
            cur.execute("rollback to savepoint s")
            check("a 'cut' event for an UNCLAIMED coin is refused", False, "it was accepted")
        except psycopg.Error as e:
            cur.execute("rollback to savepoint s")
            st = sqlstate(e)
            check("a 'cut' event for an UNCLAIMED coin is refused", st == "22023", f"wrong error {st}")
            msg = str(e).split("\n")[0]
            print(f"        message: {msg[:150]}")

        # now verify it, and the same event must be allowed
        cur.execute("update public.onlypad_coins set verified=true, creator_wallet='CreatorWa11et' where mint=%s", (MINT,))
        cur.execute("select public.onlypad_record_event(%s::text,'cut','northstar','TEST',12.5::numeric,'@northstar',null)", (MINT,))
        check("the same 'cut' event IS allowed once the coin is verified", True)

        cur.execute("select count(*) from public.onlypad_coins")
        print(f"\n  (rows visible inside this transaction: {cur.fetchone()[0]}; nothing is committed)")
        conn.rollback()

# after rollback, confirm the board is untouched
with psycopg.connect(E["SUPABASE_DB_URL"], connect_timeout=20) as conn:
    with conn.cursor() as cur:
        cur.execute("select count(*) from public.onlypad_coins")
        n = cur.fetchone()[0]
        cur.execute("select count(*) from public.onlypad_events")
        e = cur.fetchone()[0]
print(f"  after rollback: onlypad_coins={n} rows, onlypad_events={e} rows  (expected 0 and 0)")
check("the test left no rows behind", n == 0 and e == 0)

print()
print(f"RESULT: {len(passed)} passed, {len(failed)} failed")
if failed:
    print("FAILED:", failed)
sys.exit(1 if failed else 0)
