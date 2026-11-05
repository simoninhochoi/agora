# 아고라

수업용 실시간 투표·워드클라우드. GitHub Pages에 올린 정적 페이지가 화면을 맡고, 응답은 Firebase(Firestore, 서울 리전)에 저장된다.

- 학생: <https://simoninhochoi.github.io/agora/> — QR을 찍거나 6자리 코드를 넣고 닉네임을 정한다. 로그인은 필요 없다(익명).
- 강사: <https://simoninhochoi.github.io/agora/host.html> — Google 로그인. 처음 로그인한 계정이 강사 계정으로 등록된다.
- 시연: <https://simoninhochoi.github.io/agora/host.html?demo> — Firebase 없이 가짜 응답으로 발표 화면을 돌려 본다.

## 수업에서 쓰는 순서

1. 강사 화면에서 방을 만든다(과목마다 하나, 코드는 학기 내내 그대로).
2. 질문을 미리 넣어 둔다. 객관식은 보기 2~8개, 단답은 학생 1명당 1~3칸.
3. 「발표 화면 열기」를 프로젝터에 띄운다. 질문이 없으면 큰 QR과 코드가 나온다.
4. →(또는 리모컨 PageDown)로 다음 질문을 띄우면 학생 휴대폰에도 바로 나타나고 응답이 열린다.
5. C로 응답을 마감하면 가장 많이 나온 보기가 강조된다. H로 결과를 가렸다가 마감 뒤에 보여 줄 수도 있다.
6. 수업 뒤 「응답 CSV」로 닉네임별 응답을 내려받는다.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html`, `assets/student.js` | 학생 화면 |
| `host.html`, `assets/host.js` | 강사 화면(방·질문 관리) |
| `assets/present.js` | 발표 화면(막대그래프·워드클라우드) |
| `assets/demo.js` | 시연 모드 |
| `assets/firebase-config.js` | Firebase 웹 앱 설정값(공개용 식별자) |
| `firestore.rules` | 보안 규칙. 콘솔 Firestore → 규칙에 붙여 넣어 게시한다 |
| `assets/qrcode.js` | QR 생성기(Kazuhiko Arase, MIT) |

## 데이터와 규칙

```
meta/owner                         강사 계정 uid (처음 한 번만 등록)
rooms/{코드}                        방 이름, 지금 띄운 질문
rooms/{코드}/participants/{uid}     닉네임, 마지막 입장 시각
rooms/{코드}/questions/{id}         유형, 질문, 보기, 응답 열림 여부, 순서
rooms/{코드}/questions/{id}/responses/{uid}   닉네임, 고른 보기 또는 낱말
```

- 학생은 자기 응답 문서 하나만 쓸 수 있고, 그것도 지금 화면에 뜬 질문이 열려 있을 때뿐이다. 다른 학생의 응답은 읽지 못한다.
- 방·질문을 만들고 응답을 읽는 일은 `meta/owner`에 등록된 Google 계정만 할 수 있다.
- `firebase-config.js`의 apiKey는 웹 페이지에 그대로 들어가도록 만든 값이다. 접근 통제는 위 규칙이 맡는다.
- 무료(Spark) 한도: 하루 읽기 5만·쓰기 2만. 60명 수업에서 질문 20개를 돌리면 읽기 수천 건 수준이다. 학생 휴대폰은 결과를 구독하지 않고 발표 화면만 구독하도록 해서 읽기를 아꼈다.
