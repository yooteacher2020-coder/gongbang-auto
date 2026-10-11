// 매일 자동으로 카테고리별 베스트 순위를 저장 (3일 베스트 계산용)
// 매일 KST 10:00 (UTC 01:00) 실행
import { takeSnapshot } from "./lib/snapshot.mjs";

export default async () => {
  const snap = await takeSnapshot();
  console.log(`snapshot ${snap.date}: ${Object.keys(snap.categories).length} categories`, snap.errors);
};

export const config = { schedule: "0 1 * * *" };
