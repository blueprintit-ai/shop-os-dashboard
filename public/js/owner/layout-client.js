import { api } from "/static/js/api.js";

export async function getLayout() {
  return (await api("GET", "/api/layout")).json();
}
export async function saveLayout(layout) {
  return (await api("PUT", "/api/layout", layout)).json();
}
