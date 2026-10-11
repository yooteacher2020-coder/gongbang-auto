// Netlify Blobs 저장소 래퍼.
// Netlify 배포 환경에서는 Blobs를 쓰고, 로컬 테스트에서는 .data/ 폴더의 JSON 파일을 씁니다.
import { promises as fs } from "node:fs";
import path from "node:path";

const LOCAL_DIR = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), ".data");

async function blobStore(name) {
  try {
    const { getStore } = await import("@netlify/blobs");
    return getStore({ name, consistency: "strong" });
  } catch (err) {
    if (err?.name === "MissingBlobsEnvironmentError" || err?.code === "ERR_MODULE_NOT_FOUND") return null;
    throw err;
  }
}

function localFile(name, key) {
  return path.join(LOCAL_DIR, name, encodeURIComponent(key) + ".json");
}

export async function openStore(name) {
  const blobs = await blobStore(name);
  if (blobs) {
    return {
      getJSON: (key) => blobs.get(key, { type: "json" }),
      setJSON: (key, value) => blobs.setJSON(key, value),
      listKeys: async (prefix = "") => (await blobs.list({ prefix })).blobs.map((b) => b.key),
    };
  }
  return {
    async getJSON(key) {
      try {
        return JSON.parse(await fs.readFile(localFile(name, key), "utf8"));
      } catch (err) {
        if (err.code === "ENOENT") return null;
        throw err;
      }
    },
    async setJSON(key, value) {
      const file = localFile(name, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(value, null, 2));
    },
    async listKeys(prefix = "") {
      try {
        const files = await fs.readdir(path.join(LOCAL_DIR, name));
        return files.map((f) => decodeURIComponent(f.replace(/\.json$/, ""))).filter((k) => k.startsWith(prefix));
      } catch (err) {
        if (err.code === "ENOENT") return [];
        throw err;
      }
    },
  };
}
