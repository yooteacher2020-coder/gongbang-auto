# 쇼츠공방

쇼핑 쇼츠 제작 웹앱. GitHub Pages로 배포: https://yooteacher2020-coder.github.io/gongbang-auto/

- `shop.html` — 시청자용 상품 찾기 페이지. 채널 프로필 링크에 걸어두면 영상 속 상품번호로 토스쇼핑 쉐어링크에 연결됨. `shop.html?n=12`는 12번 상품을 크게 보여줌(토스 규칙상 자동 이동 안 함, 예전 쿠팡 번호는 그대로 이동).
- `products.json` — 찾기 페이지 데이터. 앱에서 영상을 만들거나 "내 상품"을 고치면 GitHub 토큰으로 자동 업데이트됨.
- `maeum/` — 마음공방(마음해킹 채널 영상 제작). 제품이 있는 영상을 만들면 `maeum.json`에 올라가고, 시청자는 `shop.html?c=maeum`에서 번호로 찾아요.
- 2026-10-22부터 **토스쇼핑 쉐어링크**로 전환. 1단계에 토스에서 복사한 내용을 붙여넣으면 자동 완성. 영상 맨 위에 대가성(광고) 문구가 항상 들어감.
- `.github/workflows/tossinfo.yml` + `scripts/tossinfo.mjs` — 토스 링크로 상품 이름·대표 사진을 가져와 `tossinfo/<요청>.json`에 저장 (운영자 토큰 필요).
- 쿠팡 시절 버전(추천 상품·쿠팡 검색 포함)은 `coupang-archive` 브랜치에 그대로 보관.
