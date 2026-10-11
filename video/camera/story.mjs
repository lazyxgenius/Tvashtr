// video/story.json, for the camera and the fixtures (F2: one source).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "story.json");
export default JSON.parse(fs.readFileSync(file, "utf8"));
