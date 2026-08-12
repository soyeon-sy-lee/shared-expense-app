export function isPublicDemoRequest(request: Request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1";
}

export function publicDemoWriteResponse() {
  return Response.json(
    { error: "공개 포트폴리오에서는 개인정보 보호를 위해 서버 저장 기능을 사용할 수 없습니다." },
    { status: 403 },
  );
}
