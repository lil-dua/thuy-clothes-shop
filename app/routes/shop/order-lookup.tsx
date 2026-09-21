import { Form, data, redirect, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/order-lookup";
import { ReceiptIcon } from "~/components/icons";
import { getOrderByCode } from "~/lib/db.server";
import { rememberOrder } from "~/lib/recent-orders.server";
import { normalizePhone } from "~/lib/format";

export function meta() {
	return [
		{ title: "Tra cứu đơn hàng — Lumi" },
		{ name: "description", content: "Nhập mã đơn và số điện thoại để xem tình trạng đơn hàng." },
	];
}

export async function action({ request, context }: Route.ActionArgs) {
	const form = await request.formData();
	const code = String(form.get("code") ?? "").trim().toUpperCase();
	const phone = normalizePhone(String(form.get("phone") ?? "").trim());

	if (!code || !phone) {
		return data({ error: "Vui lòng nhập cả mã đơn và số điện thoại" }, { status: 400 });
	}

	const order = await getOrderByCode(context.cloudflare.env.DB, code);

	// Một thông báo chung cho mọi trường hợp sai — không tiết lộ mã nào có thật.
	if (!order || normalizePhone(order.customer_phone) !== phone) {
		return data(
			{ error: "Không tìm thấy đơn hàng khớp với mã và số điện thoại này" },
			{ status: 404 },
		);
	}

	// Xác minh đúng thì ghi mã vào cookie để lần sau xem không cần nhập lại.
	return redirect(`/don-hang/${order.order_code}`, {
		headers: { "Set-Cookie": await rememberOrder(request, order.order_code) },
	});
}

export default function OrderLookup({ actionData }: Route.ComponentProps) {
	const [searchParams] = useSearchParams();
	const navigation = useNavigation();

	return (
		<div className="mx-auto max-w-md px-4 py-10 md:py-16">
			<div className="text-center">
				<span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-brand-500">
					<ReceiptIcon className="h-7 w-7" />
				</span>
				<h1 className="mt-3 text-xl font-bold text-ink-900">Tra cứu đơn hàng</h1>
				<p className="mt-1.5 text-sm text-ink-500">
					Nhập mã đơn kèm số điện thoại đã dùng khi đặt hàng.
				</p>
			</div>

			<Form method="post" className="card mt-6 space-y-4 p-5">
				<div>
					<label htmlFor="code" className="field-label">
						Mã đơn hàng
					</label>
					<input
						id="code"
						name="code"
						required
						defaultValue={searchParams.get("ma") ?? ""}
						placeholder="LUMI12345"
						autoCapitalize="characters"
						className="field uppercase"
					/>
				</div>

				<div>
					<label htmlFor="phone" className="field-label">
						Số điện thoại đặt hàng
					</label>
					<input
						id="phone"
						name="phone"
						type="tel"
						inputMode="numeric"
						required
						placeholder="0987654321"
						className="field"
					/>
				</div>

				{actionData?.error && (
					<p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
						{actionData.error}
					</p>
				)}

				<button
					type="submit"
					disabled={navigation.state === "submitting"}
					className="btn-primary btn-lg w-full"
				>
					{navigation.state === "submitting" ? "Đang tìm..." : "Tra cứu"}
				</button>
			</Form>
		</div>
	);
}
