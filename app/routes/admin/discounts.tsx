import { Form, data, redirect } from "react-router";
import type { Route } from "./+types/discounts";
import { EmptyState, PageHeader, TableWrap } from "~/components/admin/ui";
import { TrashIcon } from "~/components/icons";
import { cn, formatDate, formatVnd, parseVnd } from "~/lib/format";
import type { DiscountCode } from "~/lib/types";

export function meta() {
	return [{ title: "Khuyến mãi — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
	const { results } = await context.cloudflare.env.DB.prepare(
		`SELECT * FROM discount_codes ORDER BY is_active DESC, created_at DESC`,
	).all<DiscountCode>();
	return { codes: results ?? [] };
}

export async function action({ request, context }: Route.ActionArgs) {
	const db = context.cloudflare.env.DB;
	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");

	if (intent === "toggle") {
		await db
			.prepare(`UPDATE discount_codes SET is_active = 1 - is_active WHERE id = ?1`)
			.bind(Number.parseInt(String(form.get("id")), 10))
			.run();
		return redirect("/admin/khuyen-mai");
	}

	if (intent === "delete") {
		await db
			.prepare(`DELETE FROM discount_codes WHERE id = ?1`)
			.bind(Number.parseInt(String(form.get("id")), 10))
			.run();
		return redirect("/admin/khuyen-mai");
	}

	// Tạo mã mới
	const code = String(form.get("code") ?? "").trim().toUpperCase();
	const discountType = String(form.get("discountType") ?? "percent");
	const rawValue = String(form.get("discountValue") ?? "");
	const discountValue =
		discountType === "percent"
			? Number.parseInt(rawValue.replace(/[^\d]/g, ""), 10) || 0
			: parseVnd(rawValue);

	const errors: Record<string, string> = {};
	if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
		errors.code = "Mã gồm 3–20 ký tự chữ, số, gạch ngang";
	}
	if (discountValue <= 0) errors.discountValue = "Giá trị giảm phải lớn hơn 0";
	if (discountType === "percent" && discountValue > 100) {
		errors.discountValue = "Giảm theo % không thể vượt quá 100";
	}
	if (Object.keys(errors).length > 0) return data({ errors }, { status: 400 });

	const existing = await db
		.prepare(`SELECT 1 AS hit FROM discount_codes WHERE code = ?1`)
		.bind(code)
		.first();
	if (existing) {
		const taken: Record<string, string> = { code: "Mã này đã tồn tại" };
		return data({ errors: taken }, { status: 400 });
	}

	await db
		.prepare(
			`INSERT INTO discount_codes
			   (code, description, discount_type, discount_value, max_discount, min_order,
			    usage_limit, starts_at, ends_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
		)
		.bind(
			code,
			String(form.get("description") ?? "").trim() || null,
			discountType,
			discountValue,
			parseVnd(String(form.get("maxDiscount") ?? "")) || null,
			parseVnd(String(form.get("minOrder") ?? "")),
			Number.parseInt(String(form.get("usageLimit") ?? ""), 10) || null,
			String(form.get("startsAt") ?? "") || null,
			String(form.get("endsAt") ?? "") || null,
		)
		.run();

	return redirect("/admin/khuyen-mai");
}

export default function AdminDiscounts({ loaderData, actionData }: Route.ComponentProps) {
	const { codes } = loaderData;
	const errors = actionData?.errors ?? {};

	return (
		<>
			<PageHeader
				title="Khuyến mãi"
				description="Mã giảm giá khách nhập ở giỏ hàng hoặc trang thanh toán"
			/>

			<div className="grid gap-5 xl:grid-cols-3">
				<section className="card p-4 lg:p-5">
					<h2 className="mb-4 font-semibold text-ink-900">Tạo mã mới</h2>
					<Form method="post" className="space-y-4">
						<div>
							<label htmlFor="code" className="field-label">
								Mã giảm giá <span className="text-brand-500">*</span>
							</label>
							<input
								id="code"
								name="code"
								required
								placeholder="CHAOHE2026"
								className={`field uppercase ${errors.code ? "field-error" : ""}`}
							/>
							{errors.code && <p className="mt-1 text-xs text-red-600">{errors.code}</p>}
						</div>

						<div>
							<label htmlFor="description" className="field-label">
								Mô tả
							</label>
							<input
								id="description"
								name="description"
								placeholder="Giảm 10% mừng hè"
								className="field"
							/>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div>
								<label htmlFor="discountType" className="field-label">
									Kiểu giảm
								</label>
								<select id="discountType" name="discountType" className="field">
									<option value="percent">Theo %</option>
									<option value="amount">Số tiền</option>
								</select>
							</div>
							<div>
								<label htmlFor="discountValue" className="field-label">
									Giá trị <span className="text-brand-500">*</span>
								</label>
								<input
									id="discountValue"
									name="discountValue"
									required
									inputMode="numeric"
									placeholder="10"
									className={`field ${errors.discountValue ? "field-error" : ""}`}
								/>
							</div>
						</div>
						{errors.discountValue && (
							<p className="-mt-2 text-xs text-red-600">{errors.discountValue}</p>
						)}

						<div className="grid grid-cols-2 gap-3">
							<div>
								<label htmlFor="maxDiscount" className="field-label">
									Giảm tối đa
								</label>
								<input
									id="maxDiscount"
									name="maxDiscount"
									inputMode="numeric"
									placeholder="50.000"
									className="field"
								/>
							</div>
							<div>
								<label htmlFor="minOrder" className="field-label">
									Đơn tối thiểu
								</label>
								<input
									id="minOrder"
									name="minOrder"
									inputMode="numeric"
									placeholder="300.000"
									className="field"
								/>
							</div>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div>
								<label htmlFor="startsAt" className="field-label">
									Bắt đầu
								</label>
								<input id="startsAt" name="startsAt" type="date" className="field" />
							</div>
							<div>
								<label htmlFor="endsAt" className="field-label">
									Kết thúc
								</label>
								<input id="endsAt" name="endsAt" type="date" className="field" />
							</div>
						</div>

						<div>
							<label htmlFor="usageLimit" className="field-label">
								Giới hạn lượt dùng
							</label>
							<input
								id="usageLimit"
								name="usageLimit"
								type="number"
								min={1}
								placeholder="Để trống = không giới hạn"
								className="field"
							/>
						</div>

						<button type="submit" className="btn-primary btn-md w-full">
							Tạo mã
						</button>
					</Form>
				</section>

				<div className="xl:col-span-2">
					<TableWrap>
						{codes.length === 0 ? (
							<EmptyState
								title="Chưa có mã giảm giá nào"
								description="Tạo mã đầu tiên ở biểu mẫu bên trái."
							/>
						) : (
							<table className="w-full min-w-[42rem] text-sm">
								<thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
									<tr>
										<th className="px-4 py-2.5 font-semibold">Mã</th>
										<th className="px-4 py-2.5 font-semibold">Giảm</th>
										<th className="px-4 py-2.5 font-semibold">Điều kiện</th>
										<th className="px-4 py-2.5 text-right font-semibold">Đã dùng</th>
										<th className="px-4 py-2.5 font-semibold">Hiệu lực</th>
										<th className="px-4 py-2.5 text-right font-semibold">Thao tác</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-ink-100">
									{codes.map((discount) => (
										<tr key={discount.id} className="hover:bg-ink-50/60">
											<td className="px-4 py-2.5">
												<span className="font-mono font-semibold text-ink-800">
													{discount.code}
												</span>
												{discount.description && (
													<span className="block text-xs text-ink-400">
														{discount.description}
													</span>
												)}
											</td>
											<td className="px-4 py-2.5 text-ink-800">
												{discount.discount_type === "percent"
													? `${discount.discount_value}%`
													: formatVnd(discount.discount_value)}
												{discount.max_discount && (
													<span className="block text-xs text-ink-400">
														tối đa {formatVnd(discount.max_discount)}
													</span>
												)}
											</td>
											<td className="px-4 py-2.5 text-xs text-ink-500">
												{discount.min_order > 0
													? `Đơn từ ${formatVnd(discount.min_order)}`
													: "Không điều kiện"}
											</td>
											<td className="px-4 py-2.5 text-right text-ink-800">
												{discount.used_count}
												{discount.usage_limit ? ` / ${discount.usage_limit}` : ""}
											</td>
											<td className="px-4 py-2.5 text-xs text-ink-500">
												{discount.starts_at || discount.ends_at ? (
													<>
														{discount.starts_at ? formatDate(discount.starts_at) : "—"} →{" "}
														{discount.ends_at ? formatDate(discount.ends_at) : "—"}
													</>
												) : (
													"Không giới hạn"
												)}
											</td>
											<td className="px-4 py-2.5">
												<div className="flex items-center justify-end gap-1.5">
													<Form method="post">
														<input type="hidden" name="intent" value="toggle" />
														<input type="hidden" name="id" value={discount.id} />
														<button
															type="submit"
															className={cn(
																"badge",
																discount.is_active
																	? "bg-green-100 text-green-700 hover:bg-green-200"
																	: "bg-ink-100 text-ink-500 hover:bg-ink-200",
															)}
														>
															{discount.is_active ? "Đang bật" : "Đã tắt"}
														</button>
													</Form>
													<Form
														method="post"
														onSubmit={(event) => {
															if (!confirm(`Xoá mã ${discount.code}?`)) event.preventDefault();
														}}
													>
														<input type="hidden" name="intent" value="delete" />
														<input type="hidden" name="id" value={discount.id} />
														<button
															type="submit"
															className="grid h-8 w-8 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
															aria-label={`Xoá mã ${discount.code}`}
														>
															<TrashIcon className="h-4 w-4" />
														</button>
													</Form>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</TableWrap>
				</div>
			</div>
		</>
	);
}
