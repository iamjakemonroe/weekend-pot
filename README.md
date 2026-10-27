# Weekend Pot

A private pot for a group of friends who play Utopia together. Everyone puts in a stake, you play, and the app reads the winner from Utopia's own game records, so nobody argues about who won.

## Who does what

- **The organiser** runs the group (the **Group** tab): adds friends and sends them their links, starts and cancels pots, and decides a disputed game by hand.
- **The holder** of a pot is the friend the stakes are paid to. They put in each player who has paid them, and send the payouts. It can be the same person every week, or the group can take turns (**Group → Settings → Who holds the money**).
- **Everyone else only looks.** The one thing a friend can change is their own bank details, in **You**. The server refuses everything else.

## How a weekend works

1. **The organiser makes a pot** and picks its holder. For example: "Saturday Ludo, ₦5,000 each, games count from 7pm Saturday to 11pm Sunday, first game wins, Tobi holds the money". Taking turns, the next holder is suggested. Times show in each person's own time zone, for friends in different countries; a message posted to the group chat names its zone ("19:00 GMT+1").
2. **Everyone pays the holder.** The pot shows the holder's bank, account number (one tap to copy) and a reference, `POT-1` plus your name. **Post to the group** opens WhatsApp with all of it written.
3. **The holder puts in each player who has paid** ("Paid you? Put them in").
4. **You play in Utopia**: a friends' room with exactly the confirmed players. Ludo, Crazy Eights, Chess and Checkers all count.
5. **Every 10 minutes the app checks Utopia** for a finished game between exactly those players, and decides the pot:
   - **First game wins:** the first finished game decides it.
   - **Most wins:** play all weekend; at the end, the most wins takes the pot, and a tie shares it.
   - **No result:** a draw, or no game in time, gives everyone their stake back.
   - **Ignored:** abandoned games, and games with anyone else at the table.
   - **Disputed:** a game disputed in Utopia goes to the organiser to decide by hand, with a reason everyone sees.
6. **The holder pays out in about 30 seconds.** At the top of their page: "To send: ₦25,000 to Carol". The pot shows Carol's bank, account number and name. Copy the number and the amount into your bank app, send, then tap **Mark sent**. Carol sees "Tobi sent you ₦25,000". If the holder wins, they keep it: nothing to send.
7. **Post the result** sends "🏆 Saturday Ludo: Carol wins ₦25,000" to the group chat. The **Table** keeps everyone's running total.

## Bank details are private

Each friend saves the account their winnings go to, once, under **You** (the organiser can fill it in for someone). Who can see them:

- **you** and **the organiser**;
- **the holder** of a pot you play in, to pay you;
- while **you hold** an open pot, its players, to pay you in.

Nobody else, and the app only stores them: it never moves money.

## Why the money goes through a holder, not a card payment

The app records who paid and who won; the money itself moves by ordinary bank transfer to and from the holder.

- **Payment companies forbid it without a licence.** Collecting stakes by card and paying out winnings automatically is a betting service. Flutterwave and Paystack only allow it for licensed operators.
- **It would put Kaivon's payments at risk.** Running it through Kaivon's Flutterwave account could get that account closed, and Utopia, Wavee and Chip depend on it.
- **It would need a gaming licence.** In Nigeria, betting operators are licensed by the state (for example the Lagos State Lotteries and Gaming Authority).

A private pot between friends, with no cut taken, is a different thing. Keep it that way:

- friends only, 18+;
- **no house cut**;
- never open it to strangers;
- keep it separate from the Utopia app and its branding.

If you ever want automatic deposits, it has to go through a licensed provider.

## What the app can see in Utopia

Nothing but finished games. `utopia/reader.sql` creates a login, `weekend_pot_reader`, that can call two functions:
- **`players(usernames)`:** look up players' ids and names;
- **`games(ids, from, to)`:** list finished games among those players, with the winner.

It can't read or change any table: not balances, emails, chats or moves. `test/utopia_db.py check` proves this against Utopia's real schema (all 96 migrations).

## Set it up (about 15 minutes, once)

You need Node, the Cloudflare login you already use for Wavee (`npx wrangler whoami`), and Utopia's Supabase dashboard.

1. **Give the app its read-only login in Utopia.**
   1. Open Supabase → the Utopia project → SQL Editor.
   2. Paste all of `utopia/reader.sql` and run it.
   3. Then run this once, with a long random password of your own:
      ```sql
      alter role weekend_pot_reader password 'a-long-random-password';
      ```
2. **Get its connection string.**
   1. Supabase → Connect → **Transaction pooler**. Copy the URI.
   2. Replace the user with `weekend_pot_reader.<project-ref>` and the password with yours:
      ```
      postgresql://weekend_pot_reader.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
      ```
3. **Create the app's database** and paste the id it prints into `wrangler.jsonc` (`database_id`):
   ```sh
   npm install
   npx wrangler d1 create weekend-pot
   ```
4. **Add the two secrets.** Use any long random text for the setup key:
   ```sh
   npx wrangler secret put UTOPIA_DB_URL
   npx wrangler secret put SETUP_KEY
   ```
5. **Put it live:** `npm run deploy`. It prints the address, like `https://weekend-pot.<your-account>.workers.dev`. Keep it off kaivon.app.
6. **Set up the group.**
   1. Open the address, enter the setup key, your name and your Utopia username. You're the organiser.
   2. In **Group**, add each friend (name + Utopia username) and send each their own personal link, privately.
   3. Add your bank details under **You**, and ask everyone to add theirs.

Whoever opens a personal link is signed in as that person, so give each friend their own. If a link leaks, tap **New link**: the old one stops working.

## Run it on this Mac

```sh
npm install
printf 'UTOPIA_DB_URL=postgres://weekend_pot_reader:reader-test-password@127.0.0.1:55433/utopia\nSETUP_KEY=local-setup-key\n' > .dev.vars
python3 test/utopia_db.py serve --pg-bin <folder with initdb>   # a local Utopia database
npm run db:local && npm run dev                                 # http://localhost:8790
python3 test/utopia_db.py game ludo alice,bob,carol,dave,erin carol   # record a finished game
```

## Tests

- `npm test`: the rules for deciding a pot (12 checks).
- `python3 test/utopia_db.py check --pg-bin <dir>`: the read-only login against Utopia's real schema (14 checks).
- The end-to-end run drives the app in Chrome: five friends, bank details, a friend holding the money, a game recorded in Utopia, the payout, and who can see and change what (41 checks). It lives in the Claude scratchpad as `pot_e2e.mjs`.
