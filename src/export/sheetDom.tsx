// The chart sheets' off-screen renderer, kept apart from charts.tsx so the PDF tests (Node, no DOM) can stand it in.
// It lives in render.tsx (the export's other off-screen renderer) and is loaded on first use: importing
// react-dom/client from a second place made Rolldown split the whole engine out of the main chunk.

export { sheetSvg as renderSvg } from './render';
