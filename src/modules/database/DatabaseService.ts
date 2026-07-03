// Database client placeholder for browser/edge environments
// Note: In a real Node environment, you'd use a server-side pg pool.

export class DatabaseService {
  static async query(sql: string, params: any[] = []) {
    console.log(`Executing query: ${sql} with params: `, params);
    return [];
  }

  static async ping() {
    // Mock ping
    return true;
  }
}
