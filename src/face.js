// Finds the lips in a photo, on the device. The face model ships with the app; nothing is uploaded.

const BASE = new URL('../vendor/mediapipe/', import.meta.url).href;

// Inner lip contour (MediaPipe face mesh indices), from one mouth corner along the upper lip to the other,
// then back along the lower lip.
const UPPER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LOWER = [324, 318, 402, 317, 14, 87, 178, 88, 95];
const EYES = [33, 263]; // outer eye corners, about 90 mm apart in adults
const EYE_SPAN_MM = 90;

let landmarker = null;

async function load() {
  if (landmarker) return landmarker;
  const { FaceLandmarker, FilesetResolver } = await import(`${BASE}vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(BASE);
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `${BASE}face_landmarker.task`, delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 3,
  });
  return landmarker;
}

// Returns a mouth description for the largest face, or null when no face is found.
export async function findMouth(image, width, height) {
  const lm = await load();
  const res = lm.detect(image);
  const faces = res.faceLandmarks || [];
  if (!faces.length) return null;
  const span = (f) => Math.hypot(f[EYES[1]].x - f[EYES[0]].x, f[EYES[1]].y - f[EYES[0]].y);
  const face = faces.reduce((a, b) => (span(b) > span(a) ? b : a));
  const px = (i) => [face[i].x * width, face[i].y * height];
  return mouthFromPoints(UPPER.map(px), LOWER.map(px), px(EYES[0]), px(EYES[1]));
}

// Builds the mouth description from lip points (image pixels). Also used for the manual fallback.
export function mouthFromPoints(upper, lower, eyeA, eyeB) {
  const poly = [...upper, ...lower];
  let roll;
  let pxPerMm;
  const left = upper[0];
  const right = upper[upper.length - 1];
  if (eyeA && eyeB) {
    const [a, b] = eyeA[0] < eyeB[0] ? [eyeA, eyeB] : [eyeB, eyeA];
    roll = Math.atan2(b[1] - a[1], b[0] - a[0]);
    pxPerMm = Math.hypot(b[0] - a[0], b[1] - a[1]) / EYE_SPAN_MM;
  } else {
    const [a, b] = left[0] < right[0] ? [left, right] : [right, left];
    roll = Math.atan2(b[1] - a[1], b[0] - a[0]);
    pxPerMm = Math.hypot(b[0] - a[0], b[1] - a[1]) / 50; // a broad smile is about 50 mm between the corners
  }
  return { poly, upper: upper.length, roll, pxPerMm, anchor: anchorFor(poly, upper.length, roll, pxPerMm), auto: Boolean(eyeA) };
}

// Where the edge of the upper front teeth goes: one tooth length below the upper lip, so the gum stays hidden
// as in most natural smiles. A small mouth opening simply shows less of the teeth.
export function anchorFor(poly, upperCount, roll, pxPerMm) {
  const top = poly[Math.floor(upperCount / 2)];
  const bottom = poly[upperCount + Math.floor((poly.length - upperCount) / 2)];
  const dir = [-Math.sin(roll), Math.cos(roll)]; // "down" in the face
  const open = (bottom[0] - top[0]) * dir[0] + (bottom[1] - top[1]) * dir[1];
  const drop = 9.6 * pxPerMm;
  const k = drop - open / 2;
  return [(top[0] + bottom[0]) / 2 + dir[0] * k, (top[1] + bottom[1]) / 2 + dir[1] * k];
}

// A starting mouth in the middle of the photo when no face is found; the practice then adjusts the points.
export function defaultMouth(width, height) {
  const cx = width / 2;
  const cy = height * 0.62;
  const rx = width * 0.16;
  const ry = rx * 0.32;
  const upper = [];
  const lower = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (i / 10) * Math.PI;
    upper.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry * 0.8]);
  }
  for (let i = 1; i <= 9; i++) {
    const a = (i / 10) * Math.PI;
    lower.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return { ...mouthFromPoints(upper, lower), auto: false };
}
