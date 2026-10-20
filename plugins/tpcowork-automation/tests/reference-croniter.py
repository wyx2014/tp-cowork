"""Development-only oracle; production and normal tests never invoke Python.

Run with the reference nanobot .venv. Uses its actual _compute_next_run and locked croniter.
"""
import importlib.metadata
import importlib
import json
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from croniter import croniter
from nanobot.cron.service import _compute_next_run
from nanobot.cron.types import CronSchedule

expressions = [
    '* * * * *', '*/5 * * * MON-FRI', '0 9 31 * *', '0 0 29 2 *',
    '0 0 L * *', '0 9 15W * *', '0 9 W1 * *', '0 9 31W * *',
    '0 9 * * 5#3', '0 9 * * l5', '0 9 * * sat#1,sun#2', '0 9 13 * FRI',
    '0 9 ? * MON', '0 0 1 JAN,APR,JUL,OCT *', '0 0 * APR-JAN/3 *',
    '0 0 * * 6-7', '0 0 * * 7', '0 0 * * MON-MON', '0 0 1-31 * MON',
    '* * * * * 15,25', '* * * * * */17', '0 0 1 1 * 0 2028/2',
    '0 0 1 1 * 0 2025', '0 0 29 2 * 0 2024,2028',
    '0 0 31 2 *', '0 0 31 2 MON',
    '@midnight', '@hourly', '@daily', '@weekly', '@monthly', '@yearly', '@annually',
]
references = [
    ('2026-01-30T08:59:59.123+00:00', 'UTC'),
    ('2026-02-01T00:00:00+00:00', 'Asia/Shanghai'),
    ('2024-02-28T15:00:00+00:00', 'Asia/Kathmandu'),
    ('2026-03-08T06:59:00+00:00', 'America/New_York'),
    ('2026-11-01T05:45:00+00:00', 'America/New_York'),
    ('2026-10-04T15:15:00+00:00', 'Australia/Lord_Howe'),
]
cases = []
for expression in expressions:
    for reference, timezone in references:
        now = int(datetime.fromisoformat(reference).timestamp() * 1000)
        cases.append(dict(expression=expression, reference=reference, timezone=timezone,
                          nextRunAt=_compute_next_run(CronSchedule(kind='cron', expr=expression, tz=timezone), now)))

random_expressions = ['R * * * *', 'R/15 * * * *', 'R(10-20) * * * *', 'R(10-30)/5 * * * *',
                      'R R * * * R', '0 0 R * *', '0 0 1 R *', '0 0 * * R']
for expression in random_expressions:
    for word in [0, 1234567890, 0xFFFFFFFF]:
        reference, timezone = references[0]
        now = int(datetime.fromisoformat(reference).timestamp() * 1000)
        with patch.object(importlib.import_module('croniter.croniter').random, 'randint', return_value=word):
            cases.append(dict(expression=expression, reference=reference, timezone=timezone, randomWord=word,
                              nextRunAt=_compute_next_run(CronSchedule(kind='cron', expr=expression, tz=timezone), now)))

for timezone, reference in [
    ('America/New_York', '2026-03-08T06:59:00+00:00'),
    ('America/New_York', '2026-11-01T05:45:00+00:00'),
    ('America/New_York', '2026-11-01T06:00:00+00:00'),
    ('Europe/Berlin', '2026-03-29T00:59:59+00:00'),
    ('Europe/Berlin', '2026-10-25T00:45:00+00:00'),
    ('Australia/Lord_Howe', '2026-10-03T15:29:00+00:00'),
    ('Australia/Lord_Howe', '2026-04-04T14:45:00+00:00'),
    ('Pacific/Apia', '2011-12-29T12:00:00+00:00'),
]:
    for expression in ['30 2 * * *', '30 1 * * *', '0 * * * *', '*/15 * * * *', '* * * * * 5,35']:
        now = int(datetime.fromisoformat(reference).timestamp() * 1000)
        cases.append(dict(expression=expression, reference=reference, timezone=timezone,
                          nextRunAt=_compute_next_run(CronSchedule(kind='cron', expr=expression, tz=timezone), now)))

invalid = ['99 * * * *', '* * *', '* * * * * * * *', '@reboot', 'H * * * *',
           '0 0 * * * 0 2100', '0 0 * * * 0 1969', '0 0 * * * 60', '0 0 * * 7 0',
           '0 0 * * 1,5#2', '0 9 1W,2W * *', '0 0 * * 1-5#3', '0 0 0 * *', '*/0 * * * *']
validity = [dict(expression=e, valid=croniter.is_valid(e)) for e in expressions + random_expressions + invalid]
target = Path(__file__).parent / 'fixtures/croniter.json'
target.write_text(json.dumps(dict(version=importlib.metadata.version('croniter'), cases=cases, validity=validity),
                             ensure_ascii=False, indent=2) + '\n')
print(f'{len(cases)} next-run cases; {len(validity)} validity cases; croniter {importlib.metadata.version("croniter")}')
