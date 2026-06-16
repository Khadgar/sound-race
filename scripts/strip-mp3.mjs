/**
 * Post-sync script: removes bundled MP3s from the Android assets
 * so the APK stays small. Featured tracks are downloaded on first
 * run via the Cache API instead.
 *
 * Usage: node scripts/strip-mp3.mjs
 */

import { readdirSync, unlinkSync } from "fs";
import { join } from "path";

const assetsDir = join("android", "app", "src", "main", "assets", "public");

let removed = 0;
try {
  for (const file of readdirSync(assetsDir)) {
    if (file.endsWith(".mp3")) {
      unlinkSync(join(assetsDir, file));
      console.log(`Stripped ${file} from Android assets`);
      removed++;
    }
  }
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

if (removed > 0) {
  console.log(`Done — removed ${removed} MP3(s) from APK assets.`);
} else {
  console.log("No MP3s found in Android assets (already clean).");
}
