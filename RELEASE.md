# 업데이트할 때 체크리스트

버전을 올릴 때마다 아래를 **항상 함께** 맞춥니다.

1. `manifest.json`의 `version`
2. `README.md`: 버전 배지, 주요 기능·단축키·권한·파일 구조, 버전 기록
3. `ROADMAP.md`: 항목 상태와 완료 기록
4. 설치 안내 페이지 `docs/index.html`: `VERSION` 값과 버전 표시, 사용법·자주 묻는 질문
5. 다운로드 파일 `docs/iSubby.zip`: 확장 실행 파일만 담아 다시 만들기
   (`manifest.json`, `*.js`, `*.css`, `popup.html`, `icons/`, `LICENSE`)
6. 권한이나 접근 범위가 바뀌면 `PRIVACY.md`와 스토어 등록 정보(권한 사유)
7. 크롬 웹 스토어용 zip (스토어에 올릴 때)

커밋 작성자는 AePhroDeChi, 이메일은 GitHub 비공개 주소를 씁니다.
