export class PersistenceManager {
  set(name, value) {
    localStorage.setItem(name, value);
  }

  get(name) {
    return localStorage.getItem(name);
  }
}
