import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActivatedDevice, getOperatorSessionId } from "@/lib/operator-auth";
import { getOpenShift, isShiftTooLong } from "@/lib/work-time";

export async function GET() {
  const device = await getActivatedDevice();
  if (!device) {
    return NextResponse.json({ device: null, operator: null });
  }
  const point = device.point;

  const tenant = await prisma.tenant.findUnique({ where: { id: point.tenantId } });
  const deviceInfo = {
    pointId: point.id,
    pointName: point.name,
    tenantName: tenant?.name ?? null,
    roaming: device.roaming,
  };
  // Модуль Рабочее время всегда включён (docs/spec/00-architecture.md —
  // модули больше не гейтятся, разница пакетов только в числовых лимитах);
  // поле оставлено в ответе, чтобы не трогать клиентский код PWA оператора.
  const workTimeEnabled = true;

  const operatorId = await getOperatorSessionId();
  if (!operatorId) {
    return NextResponse.json({ device: deviceInfo, operator: null, workTimeEnabled });
  }

  const operator = await prisma.operator.findUnique({ where: { id: operatorId } });
  if (!operator || !operator.active || operator.tenantId !== point.tenantId) {
    return NextResponse.json({ device: deviceInfo, operator: null, workTimeEnabled });
  }

  // Состояние check-in/check-out (docs/spec/05-work-time.md, "АВТО") нужно на
  // главном экране PWA сразу при загрузке — иначе кнопка "Начать/Закончить
  // смену" на миг мигала бы неверным состоянием после перезагрузки страницы.
  const activeShift = await getOpenShift(operator.id);

  return NextResponse.json({
    device: deviceInfo,
    operator: { id: operator.id, name: operator.name, avatarUrl: operator.avatarUrl, iconKey: operator.iconKey },
    workTimeEnabled,
    timeTrackingMode: operator.timeTrackingMode,
    activeShift: activeShift
      ? { id: activeShift.id, startAt: activeShift.startAt, tooLong: isShiftTooLong(activeShift.startAt) }
      : null,
  });
}
