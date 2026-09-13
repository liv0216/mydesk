import Link from 'next/link';
export const metadata = { title: 'My Desk 소개' };
export default function AboutPage() {
  return <main className="info-page"><article><p className="eyebrow">MY DESK</p><h1>나만의 하루를 한곳에.</h1><p>My Desk는 개인 일정, 학사력, 시간표와 할 일을 함께 관리하는 대시보드입니다.</p><h2>이메일로 시작하고, Google 캘린더도 함께</h2><p>이메일 인증 후 개인 데스크를 사용할 수 있습니다. Google 계정을 연결하면 사용자가 허용한 캘린더의 일정을 읽어 학사력 PDF와 직접 지정한 일정 옆에 표시합니다. 처음 연결할 때 Google의 권한 승인이 필요합니다.</p><h2>내 계정에 저장하는 학사 일정</h2><p>학사력 PDF의 전체 페이지를 브라우저에서 분석하고, 인식한 일정과 파일명만 개인 데스크에 저장합니다. Google 일정은 Google 캘린더에서 관리하며 My Desk에서는 읽기만 합니다.</p><p><Link className="info-primary" href="/">내 데스크 시작하기</Link></p><footer><Link href="/privacy">개인정보 처리 안내</Link><a href="mailto:liv0216@gmail.com">운영자에게 문의</a></footer></article></main>;
}
