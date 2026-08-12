import {
  deleteTrainingLabel,
  listTrainingLabels,
  saveTrainingLabel,
  type TrainingLabel,
} from "@/db/training-labels";
import { isPublicDemoRequest, publicDemoWriteResponse } from "@/app/public-demo";

export async function GET(request: Request) {
  if (isPublicDemoRequest(request)) return Response.json({ labels: [], demo: true });
  return Response.json({ labels: await listTrainingLabels() });
}

export async function POST(request: Request) {
  if (isPublicDemoRequest(request)) return publicDemoWriteResponse();
  const payload = (await request.json()) as { transactionId?: string; label?: string };
  const transactionId = payload.transactionId?.trim() || "";
  const label = payload.label as TrainingLabel["label"];
  if (!/^C-\d{8}-[a-f0-9]{12}$/.test(transactionId)) {
    return Response.json({ error: "올바르지 않은 거래입니다." }, { status: 400 });
  }
  if (label !== "shared" && label !== "personal") {
    return Response.json({ error: "공동지출 또는 개인지출을 선택해 주세요." }, { status: 400 });
  }
  await saveTrainingLabel(transactionId, label);
  return Response.json({ ok: true, transactionId, label });
}

export async function DELETE(request: Request) {
  if (isPublicDemoRequest(request)) return publicDemoWriteResponse();
  const transactionId = new URL(request.url).searchParams.get("transactionId") || "";
  if (!/^C-\d{8}-[a-f0-9]{12}$/.test(transactionId)) {
    return Response.json({ error: "올바르지 않은 거래입니다." }, { status: 400 });
  }
  await deleteTrainingLabel(transactionId);
  return Response.json({ ok: true });
}
