# My Desk

개인별 일정, 시간표, 할 일과 Google Calendar를 한 화면에서 관리하는 Next.js 앱입니다. Vercel에서 실행합니다.

## 실행

Node.js 22.13 이상에서 `npm ci`, `npm run dev`를 실행합니다. `npm run build`로 운영 빌드, `npm test`로 데이터 분리·PDF·캘린더·암호화 검증을 실행합니다.

## Vercel 배포

GitHub 저장소를 연결하고 Framework Preset을 Next.js, Root Directory를 저장소 루트로 설정합니다. 출력 폴더는 기본값을 사용합니다. `vercel.json`이 빌드 설정을 제공합니다.

Vercel의 무료 Neon 통합에서 Auth를 켜고 프로젝트를 연결합니다. `DATABASE_URL`과 `NEON_AUTH_BASE_URL`은 통합이 제공합니다. 32바이트 이상 난수로 생성한 `NEON_AUTH_COOKIE_SECRET`을 서버 환경변수에 저장합니다. 로컬에서는 `.env.local`을 사용하고 Git에 커밋하지 않습니다. `scripts/vercel-schema.sql`을 데이터베이스에 한 번 적용합니다. 이 스키마는 데이터나 계정을 생성하지 않습니다.

## 개인 데이터

이메일 인증번호로 가입·로그인합니다. API는 검증된 서버 세션의 사용자 ID로만 데이터를 읽고 씁니다. 처음 로그인한 사용자는 빈 데스크로 시작합니다. 이전 사이트의 자료를 자동으로 복원하거나 다른 사용자에게 복사하지 않습니다.

Google Calendar의 비공개 iCal 주소는 각 사용자가 연결 설정에서 입력합니다. 서버에 암호화하여 저장하고 브라우저 응답에 주소를 돌려주지 않습니다. Google 일정 편집은 Google Calendar에서 진행합니다. 세션 비밀값을 바꾸면 기존 캘린더 암호화 값도 바뀌므로 사용자에게 재연결이 필요합니다.

## 학사력 PDF

PDF 전체 페이지의 텍스트·표 좌표에서 학년도를 읽으며 다음 해 1·2월, 괄호 날짜와 기간 일정을 처리합니다. 같은 파일명으로 가져오면 해당 PDF의 일정만 갱신하며 직접 지정 일정은 유지합니다. 최대 5,000개이며 초과분을 조용히 자르지 않습니다. 스캔형 PDF는 OCR이 필요합니다. PDF 분석은 브라우저에서 수행하고 추출된 일정·파일명만 저장합니다. PDF 원본은 업로드하지 않습니다.

## 보안

GitHub Actions의 Secret scan이 커밋 이력에 비밀키가 포함됐는지 검사합니다. `.env*`, 비공개 캘린더 주소, DB 연결 주소와 세션 키를 저장소에 넣지 마세요.
