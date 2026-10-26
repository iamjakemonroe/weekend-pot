// Read-only access to Utopia's database through the weekend_pot_reader login
// (utopia/reader.sql): two functions, nothing else.
import postgres from 'postgres';
import type { UtopiaGame } from './decide';

export interface UtopiaPlayer {
  id: string;
  username: string;
  display_name: string | null;
}

export interface Utopia {
  players(usernames: string[]): Promise<UtopiaPlayer[]>;
  games(ids: string[], from: string, to: string): Promise<UtopiaGame[]>;
  close(): Promise<void>;
}

const USERNAME = /^[a-z0-9_]{3,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function utopia(url: string): Utopia {
  // Supabase's pooler in transaction mode: no prepared statements. One short-lived connection.
  const sql = postgres(url, { prepare: false, max: 1, fetch_types: false, connect_timeout: 10, idle_timeout: 5 });
  return {
    async players(usernames) {
      const clean = usernames.map((u) => u.trim().toLowerCase()).filter((u) => USERNAME.test(u));
      if (!clean.length) return [];
      const [row] = await sql`select weekend_pot.players(string_to_array(${clean.join(',')}, ',')) as list`;
      return row.list as UtopiaPlayer[];
    },
    async games(ids, from, to) {
      const clean = ids.filter((id) => UUID.test(id));
      if (clean.length < 2) return [];
      const [row] = await sql`
        select weekend_pot.games(string_to_array(${clean.join(',')}, ',')::uuid[], ${from}::timestamptz, ${to}::timestamptz) as list`;
      return row.list as UtopiaGame[];
    },
    close: () => sql.end({ timeout: 2 }),
  };
}
