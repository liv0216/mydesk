# My Desk

개인별 일정, 시간표, 할 일과 Google Calendar를 한 화면에서 관리하는 Next.js 앱입니다. Vercel에서 실행합니다.

## 실행

Node.js 22.13 이상에서 `npm ci`, `npm run dev`를 실행합니다. `npm run build`로 운영 빌드, `npm test`로 데이터 분리·PDF·캘린더·암호화 검증을 실행합니다.

## Vercel 배포

GitHub 저장소를 연결하고 Framework Preset을 Next.js, Root Directory를 저장소 루트로 설정합니다. 출력 폴더는 기본값을 사용합니다. `vercel.json`이 빌드 설정을 제공합니다.

Vercel의 무료 Neon 통합에서 Auth를 켜고 프로젝트를 연결합니다. `DATABASE_URL`과 `NEON_AUTH_BASE_URL`은 통합이 제공합니다. 32바이트 이상 난수로 생성한 `NEON_AUTH_COOKIE_SECRET`을 서버 환경변수에 저장합니다. 로컬에서는 `.env.local`을 사용하고 Git에 커밋하지 않습니다. `scripts/vercel-schema.sql`을 데이터베이스에 한 번 적용합니다. 이 스키마는 데이터나 계정을 생성하지 않습니다.

## 개인 데이터

이메일 인증번호로 가입·로그인합니다. API는 검증된 서버 세션의 사용자 ID로만 데이터를 읽고 씁니다. 처음 로그인한 사용자는 빈 데스크로 시작합니다. 이전 사이트의 자료를 자동으로 복원하거나 다른 사용자에게 복사하지 않습니다.

인증번호를 다시 요청하면 가장 최근 메일의 번호를 사용합니다. 입력 시 공백·하이픈은 자동으로 정리되며, 재발급은 30초 간격으로 요청할 수 있습니다. 잘못된 번호의 반복 입력으로 시도 한도를 넘으면 새 번호를 받아야 합니다. 브라우저에는 발송 이메일과 시각만 잠시 기억하며 인증번호나 인증 토큰을 직접 보관하지 않습니다.

인증 장애를 확인할 때 Vercel 로그의 `Authentication request rejected`에서 동작·HTTP 상태·오류 코드만 확인합니다. 인증번호, 이메일, 쿠키, 토큰과 요청 본문을 로그에 추가하지 않습니다.

Google 계정을 처음 한 번 연결하면 다음 로그인에서도 캘린더를 자동으로 불러옵니다. 로그인한 이메일을 Google 계정 선택의 힌트로 사용하며, Google 연결 계정과 데스크 소유권은 별도로 검증합니다. Google 일정 편집은 Google Calendar에서 진행합니다. 토큰은 서버에 암호화하여 저장하며 브라우저 응답에 반환하지 않습니다. 기존 비공개 iCal 방식은 고급 설정에서 사용할 수 있습니다. 세션 비밀값을 바꾸면 기존 캘린더 암호화 값도 바뀌므로 사용자에게 재연결이 필요합니다.

## Google 계정 연결 설정

Google Cloud에서 Calendar API를 활성화하고 외부 OAuth 웹 애플리케이션을 만듭니다. 승인된 리디렉션 URI를 `https://내-도메인/api/google-calendar/callback`으로 정확히 등록합니다. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`를 Vercel 서버 환경변수에 설정하고 `scripts/google-oauth-schema.sql`을 적용합니다. 클라이언트 비밀값은 민감한 환경변수로 저장하고 Git에 넣지 않습니다.

요청 범위는 `openid`, `email`, `calendar.events.readonly`, `calendar.calendarlist.readonly`입니다. 캘린더 목록과 일정의 읽기 권한만 사용합니다. Google 인증 플랫폼의 테스트 모드에서는 등록한 테스트 사용자만 연결할 수 있고 갱신 토큰의 수명이 제한될 수 있습니다. 일반 사용자에게 제공하려면 프로덕션 게시 및 Google이 요구하는 앱 검증을 완료해야 합니다. 공개 소개는 `/about`, 개인정보 처리 안내는 `/privacy`에 있습니다. 무료 사용 조건에 맞게 결제 계정 없이 운영하고 Google API 할당량을 확인합니다.

## 학사력 PDF

PDF 전체 페이지의 텍스트·표 좌표에서 학년도를 읽으며 다음 해 1·2월, 괄호 날짜와 기간 일정을 처리합니다. 같은 파일명으로 가져오면 해당 PDF의 일정만 갱신하며 직접 지정 일정은 유지합니다. 최대 5,000개이며 초과분을 조용히 자르지 않습니다. 스캔형 PDF는 OCR이 필요합니다. PDF 분석은 브라우저에서 수행하고 추출된 일정·파일명만 저장합니다. PDF 원본은 업로드하지 않습니다.

## 보안

GitHub Actions의 Secret scan이 커밋 이력에 비밀키가 포함됐는지 검사합니다. `.env*`, 비공개 캘린더 주소, DB 연결 주소와 세션 키를 저장소에 넣지 마세요.
