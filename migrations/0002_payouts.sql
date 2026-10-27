-- Paying out in seconds: everyone keeps the bank account their winnings go to, and each pot
-- has a holder (the member its stakes are paid to), so the job can take turns week by week.

-- Where this member's winnings and refunds are sent. Private: see state() in worker/index.ts.
alter table members add column bank_name text;
alter table members add column account_number text;
alter table members add column account_name text;

-- The member the stakes are paid to, who puts players in and sends the payouts.
alter table pots add column holder_id integer references members (id);
update pots set holder_id = created_by where holder_id is null;

-- rotate: '1' when the holder takes turns from pot to pot (the default for a new pot).
insert or ignore into settings (key, value) values ('rotate', '0');
