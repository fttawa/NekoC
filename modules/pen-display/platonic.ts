import { pdState, pdItem } from "./state";
import { vertex } from "./platonic-vertex";

/** Canonical Platonic vertices, nearest-neighbour edges, common circumradius 160.
 * poly_solid selects tetrahedron/cube/octahedron/dodecahedron/icosahedron (1..5).
 * Run at a frame boundary inside warp; output indices are native one-based lists.
 */
export function buildPlatonic(): void {
  deleteListItem("poly_vx", "all", 1); deleteListItem("poly_vy", "all", 1);
  deleteListItem("poly_vz", "all", 1);
  deleteListItem("poly_ea", "all", 1); deleteListItem("poly_eb", "all", 1);
  setVar("poly_built_solid", pdState("poly_solid"));
  setVar("poly_phi", 1.618033988749895);
  setVar("poly_inv_phi", 0.6180339887498948);
  setVar("poly_radius_scale", 160 / 1.7320508075688772);
  if (pdState("poly_built_solid") === 1) {
    setVar("poly_faces", 4); setVar("poly_name", "TETRAHEDRON");
    setVar("poly_edge_squared", 8);
    vertex(1, 1, 1); vertex(1, -1, -1); vertex(-1, 1, -1); vertex(-1, -1, 1);
  } else if (pdState("poly_built_solid") === 3) {
    setVar("poly_faces", 8); setVar("poly_name", "OCTAHEDRON");
    setVar("poly_edge_squared", 2); setVar("poly_radius_scale", 160);
    vertex(1, 0, 0); vertex(-1, 0, 0); vertex(0, 1, 0);
    vertex(0, -1, 0); vertex(0, 0, 1); vertex(0, 0, -1);
  } else if (pdState("poly_built_solid") === 5) {
    setVar("poly_faces", 20); setVar("poly_name", "ICOSAHEDRON");
    setVar("poly_edge_squared", 4);
    setVar("poly_radius_scale", 160 / 1.902113032590307);
    for (let icoA = -1; icoA <= 1; icoA += 2) {
      for (let icoB = -1; icoB <= 1; icoB += 2) {
        vertex(0, icoA, icoB * pdState("poly_phi"));
        vertex(icoA, icoB * pdState("poly_phi"), 0);
        vertex(icoB * pdState("poly_phi"), 0, icoA);
      }
    }
  } else {
    // Cube vertices are also eight of the dodecahedron's twenty vertices.
    for (let cubeX = -1; cubeX <= 1; cubeX += 2) {
      for (let cubeY = -1; cubeY <= 1; cubeY += 2) {
        for (let cubeZ = -1; cubeZ <= 1; cubeZ += 2) vertex(cubeX, cubeY, cubeZ);
      }
    }
    setVar("poly_faces", 6); setVar("poly_name", "CUBE");
    setVar("poly_edge_squared", 4);
    if (pdState("poly_built_solid") === 4) {
      setVar("poly_faces", 12); setVar("poly_name", "DODECAHEDRON");
      setVar("poly_edge_squared", 4 * pdState("poly_inv_phi") * pdState("poly_inv_phi"));
      for (let dodA = -1; dodA <= 1; dodA += 2) {
        for (let dodB = -1; dodB <= 1; dodB += 2) {
          vertex(0, dodA * pdState("poly_inv_phi"), dodB * pdState("poly_phi"));
          vertex(dodA * pdState("poly_inv_phi"), dodB * pdState("poly_phi"), 0);
          vertex(dodB * pdState("poly_phi"), 0, dodA * pdState("poly_inv_phi"));
        }
      }
    }
  }
  setVar("poly_vertex_count", listLength("poly_vx"));
  for (let edgeI = 1; edgeI < pdState("poly_vertex_count"); edgeI++) {
    for (let edgeJ = edgeI + 1; edgeJ <= pdState("poly_vertex_count"); edgeJ++) {
      setVar("poly_ex", pdItem("poly_vx", edgeI) - pdItem("poly_vx", edgeJ));
      setVar("poly_ey", pdItem("poly_vy", edgeI) - pdItem("poly_vy", edgeJ));
      setVar("poly_ez", pdItem("poly_vz", edgeI) - pdItem("poly_vz", edgeJ));
      setVar("poly_distance_squared", pdState("poly_ex") * pdState("poly_ex") + pdState("poly_ey") * pdState("poly_ey") + pdState("poly_ez") * pdState("poly_ez"));
      if (mathFunc("abs", pdState("poly_distance_squared") - pdState("poly_edge_squared")) < 0.000001) {
        appendList("poly_ea", edgeI); appendList("poly_eb", edgeJ);
      }
    }
  }
  setVar("poly_edge_count", listLength("poly_ea"));
  for (let scaleIndex = 1; scaleIndex <= pdState("poly_vertex_count"); scaleIndex++) {
    replaceListItem("poly_vx", "any", scaleIndex, pdItem("poly_vx", scaleIndex) * pdState("poly_radius_scale"));
    replaceListItem("poly_vy", "any", scaleIndex, pdItem("poly_vy", scaleIndex) * pdState("poly_radius_scale"));
    replaceListItem("poly_vz", "any", scaleIndex, pdItem("poly_vz", scaleIndex) * pdState("poly_radius_scale"));
  }
}
