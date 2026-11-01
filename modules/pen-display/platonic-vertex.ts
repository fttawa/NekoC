/** Append one canonical vertex to the shared geometry lists. */
export function vertex(vx: number, vy: number, vz: number): void {
  appendList("poly_vx", vx); appendList("poly_vy", vy); appendList("poly_vz", vz);
}
