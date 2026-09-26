import { Form, Link, data, redirect } from "react-router";
import type { Route } from "./+types/settings";
import { PageHeader } from "~/components/admin/ui";
import { CheckIcon, TrashIcon, UploadIcon } from "~/components/icons";
import { requireAdmin, hashPassword, verifyPassword } from "~/lib/auth.server";
import { getCategories } from "~/lib/db.server";
import { slugify } from "~/lib/format";
import { uploadProductImage } from "~/lib/images.server";
import { IMAGE_PLACEHOLDER, imageUrl } from "~/lib/images";
import {
	DEFAULT_CAPTION_TEMPLATE,
	getSecret,
	getSettings,
	hasSecret,
	setSecret,
	updateSettings,
	type ShopSettings,
} from "~/lib/settings.server";
import { listSocialSets } from "~/lib/threads.server";
import { sendTestEmail } from "~/lib/email.server";
import {
	listTelegramChats,
	renderTestMessage,
	sendTelegramMessage,
	type TelegramChat,
} from "~/lib/telegram.server";
import { THREADS_PLACEHOLDERS, type SocialSet } from "~/lib/threads";
import { TARGET_GROUPS, type TargetGroup } from "~/lib/types";

export function meta() {
	return [{ title: "Cài đặt — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const db = env.DB;
	const [settings, categories, user] = await Promise.all([
		getSettings(db),
		getCategories(db),
		requireAdmin(db, request),
	]);

	const envRecord = env as unknown as Record<string, unknown>;
	const apiKeySet = await hasSecret(db, "typefully_api_key", envRecord);
	const resendKeySet = await hasSecret(db, "resend_api_key", envRecord);
	const telegramKeySet = await hasSecret(db, "telegram_bot_token", envRecord);

	// Danh sách tài khoản Typefully chỉ nạp khi chủ shop bấm nút, vì mỗi lần nạp
	// là một lượt gọi ra API bên ngoài — không nên chạy ở mọi lần mở trang.
	let socialSets: SocialSet[] = [];
	let socialSetsError: string | null = null;
	if (apiKeySet && new URL(request.url).searchParams.has("tai-khoan")) {
		const apiKey = await getSecret(db, "typefully_api_key", envRecord);
		const result = await listSocialSets(apiKey!);
		if (result.ok) socialSets = result.sets;
		else socialSetsError = result.error;
	}

	// Dò chat Telegram cũng chỉ chạy khi bấm nút, vì mỗi lần là một lượt gọi ra
	// ngoài và getUpdates chỉ giữ lại tin trong ~24 giờ.
	let telegramChats: TelegramChat[] = [];
	let telegramError: string | null = null;
	if (telegramKeySet && new URL(request.url).searchParams.has("chat")) {
		const token = await getSecret(db, "telegram_bot_token", envRecord);
		const found = await listTelegramChats(token!);
		if (found.ok) telegramChats = found.chats;
		else telegramError = found.error;
	}

	return {
		settings,
		categories,
		user,
		apiKeySet,
		resendKeySet,
		telegramKeySet,
		telegramChats,
		telegramError,
		socialSets,
		socialSetsError,
	};
}

export async function action({ request, context }: Route.ActionArgs) {
	const env = context.cloudflare.env;
	const db = env.DB;
	const user = await requireAdmin(db, request);

	const form = await request.formData();
	const intent = String(form.get("intent") ?? "");

	// --- Thông tin shop / vận chuyển -------------------------------------
	if (intent === "shop" || intent === "shipping") {
		const keys =
			intent === "shop"
				? (["shop_name", "shop_tagline", "shop_phone", "shop_email", "shop_address", "threads_handle"] as const)
				: (["shipping_fee", "free_shipping_threshold", "order_hold_minutes", "return_policy_days"] as const);

		const values: Partial<Record<keyof ShopSettings, string>> = {};
		for (const key of keys) values[key] = String(form.get(key) ?? "").trim();
		await updateSettings(db, values);
		return data({ message: "Đã lưu cài đặt" });
	}

	// --- Thông tin nhận tiền ----------------------------------------------
	if (intent === "payment") {
		const values: Partial<Record<keyof ShopSettings, string>> = {
			bank_id: String(form.get("bank_id") ?? "").trim().toUpperCase(),
			bank_account_no: String(form.get("bank_account_no") ?? "").trim(),
			bank_account_name: String(form.get("bank_account_name") ?? "").trim().toUpperCase(),
			momo_phone: String(form.get("momo_phone") ?? "").trim(),
			momo_name: String(form.get("momo_name") ?? "").trim(),
		};

		const qrFile = form.get("momo_qr");
		if (qrFile instanceof File && qrFile.size > 0) {
			const upload = await uploadProductImage(env.IMAGES, qrFile, "settings");
			if (!upload.ok) return data({ error: upload.error }, { status: 400 });
			values.momo_qr_key = upload.key;
		}
		if (form.get("removeMomoQr") === "1") values.momo_qr_key = "";

		await updateSettings(db, values);
		return data({ message: "Đã lưu thông tin thanh toán" });
	}

	// --- Telegram ----------------------------------------------------------
	if (intent === "telegram") {
		const token = String(form.get("telegram_bot_token") ?? "").trim();
		if (token) await setSecret(db, "telegram_bot_token", token);

		await updateSettings(db, {
			telegram_chat_id: String(form.get("telegram_chat_id") ?? "").trim(),
		});
		return redirect("/admin/cai-dat?chat=1#telegram");
	}

	if (intent === "telegram-test") {
		const [current, token] = await Promise.all([
			getSettings(db),
			getSecret(db, "telegram_bot_token", env as unknown as Record<string, unknown>),
		]);
		if (!token) return data({ error: "Chưa lưu token bot Telegram" }, { status: 400 });
		if (!current.telegram_chat_id) {
			return data({ error: "Chưa chọn cuộc trò chuyện nhận tin" }, { status: 400 });
		}

		const sent = await sendTelegramMessage(
			token,
			current.telegram_chat_id,
			renderTestMessage(current),
		);
		return sent.ok
			? data({ message: "Đã gửi tin thử qua Telegram" })
			: data({ error: sent.error }, { status: 400 });
	}

	// --- Email -------------------------------------------------------------
	if (intent === "email") {
		const key = String(form.get("resend_api_key") ?? "").trim();
		if (key) await setSecret(db, "resend_api_key", key);

		await updateSettings(db, {
			email_from: String(form.get("email_from") ?? "").trim(),
			email_owner: String(form.get("email_owner") ?? "").trim(),
		});
		return data({ message: "Đã lưu cấu hình email" });
	}

	if (intent === "email-test") {
		const to = String(form.get("testTo") ?? "").trim();
		if (!to) return data({ error: "Nhập địa chỉ nhận thư thử" }, { status: 400 });

		const [current, apiKey] = await Promise.all([
			getSettings(db),
			getSecret(db, "resend_api_key", env as unknown as Record<string, unknown>),
		]);
		if (!apiKey) return data({ error: "Chưa lưu API key Resend" }, { status: 400 });
		if (!current.email_from) {
			return data({ error: "Chưa điền địa chỉ gửi" }, { status: 400 });
		}

		const sent = await sendTestEmail(apiKey, current, to);
		return sent.ok
			? data({ message: `Đã gửi thư thử tới ${to}` })
			: data({ error: sent.error }, { status: 400 });
	}

	// --- Threads / Typefully ----------------------------------------------
	if (intent === "threads-key") {
		const key = String(form.get("typefully_api_key") ?? "").trim();
		if (!key) return data({ error: "Vui lòng dán API key" }, { status: 400 });

		// Kiểm tra khoá bằng một lượt gọi thật trước khi lưu, để chủ shop biết
		// ngay là dán sai chứ không phải chờ tới lúc đăng bài mới lỗi.
		const check = await listSocialSets(key);
		if (!check.ok) return data({ error: check.error }, { status: 400 });

		await setSecret(db, "typefully_api_key", key);
		return redirect("/admin/cai-dat?tai-khoan=1#threads");
	}

	if (intent === "threads-account") {
		const [id, ...nameParts] = String(form.get("socialSet") ?? "").split("|");
		if (!id) return data({ error: "Chọn một tài khoản để đăng bài" }, { status: 400 });
		await updateSettings(db, {
			typefully_social_set_id: id,
			typefully_social_set_name: nameParts.join("|"),
		});
		return data({ message: "Đã chọn tài khoản đăng bài" });
	}

	if (intent === "threads-template") {
		await updateSettings(db, {
			threads_caption_template:
				String(form.get("threads_caption_template") ?? "").trim() || DEFAULT_CAPTION_TEMPLATE,
			threads_auto_post: form.get("threads_auto_post") === "on" ? "1" : "0",
		});
		return data({ message: "Đã lưu mẫu caption" });
	}

	// --- Danh mục ----------------------------------------------------------
	if (intent === "category-add") {
		const name = String(form.get("categoryName") ?? "").trim();
		const group = String(form.get("targetGroup") ?? "");
		if (name.length < 2 || !["women", "kids"].includes(group)) {
			return data({ error: "Nhập tên danh mục và chọn nhóm đối tượng" }, { status: 400 });
		}

		// Slug phải kèm nhóm: "Váy" của đồ nữ và của trẻ em là hai danh mục khác nhau
		const slug = `${slugify(name)}-${group === "women" ? "nu" : "tre-em"}`;
		const existing = await db
			.prepare(`SELECT 1 AS hit FROM categories WHERE slug = ?1`)
			.bind(slug)
			.first();
		if (existing) return data({ error: "Danh mục này đã tồn tại" }, { status: 400 });

		await db
			.prepare(
				`INSERT INTO categories (slug, name, target_group, sort_order)
				 VALUES (?1, ?2, ?3,
				   (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE target_group = ?3))`,
			)
			.bind(slug, name, group)
			.run();
		return data({ message: `Đã thêm danh mục "${name}"` });
	}

	if (intent === "category-toggle") {
		await db
			.prepare(`UPDATE categories SET is_active = 1 - is_active WHERE id = ?1`)
			.bind(Number.parseInt(String(form.get("categoryId")), 10))
			.run();
		return data({ message: "Đã cập nhật danh mục" });
	}

	// --- Đổi mật khẩu ------------------------------------------------------
	if (intent === "password") {
		const current = String(form.get("currentPassword") ?? "");
		const next = String(form.get("newPassword") ?? "");
		const confirm = String(form.get("confirmPassword") ?? "");

		if (next.length < 8) {
			return data({ error: "Mật khẩu mới cần ít nhất 8 ký tự" }, { status: 400 });
		}
		if (next !== confirm) {
			return data({ error: "Mật khẩu xác nhận không khớp" }, { status: 400 });
		}

		const row = await db
			.prepare(`SELECT password_hash FROM admin_users WHERE id = ?1`)
			.bind(user.id)
			.first<{ password_hash: string }>();
		if (!row || !(await verifyPassword(current, row.password_hash))) {
			return data({ error: "Mật khẩu hiện tại không đúng" }, { status: 400 });
		}

		await db
			.prepare(`UPDATE admin_users SET password_hash = ?2 WHERE id = ?1`)
			.bind(user.id, await hashPassword(next))
			.run();

		// Đổi mật khẩu thì thu hồi mọi phiên khác đang đăng nhập
		await db
			.prepare(`DELETE FROM admin_sessions WHERE admin_user_id = ?1`)
			.bind(user.id)
			.run();

		return data({ message: "Đã đổi mật khẩu. Vui lòng đăng nhập lại." });
	}

	return data({ error: "Thao tác không hợp lệ" }, { status: 400 });
}

export default function AdminSettings({ loaderData, actionData }: Route.ComponentProps) {
	const {
		settings,
		categories,
		apiKeySet,
		resendKeySet,
		telegramKeySet,
		telegramChats,
		telegramError,
		socialSets,
		socialSetsError,
	} = loaderData;

	return (
		<>
			<PageHeader
				title="Cài đặt"
				description="Thông tin shop, tài khoản nhận tiền, phí vận chuyển và danh mục"
			/>

			{actionData && "message" in actionData && actionData.message && (
				<p className="mb-4 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
					<CheckIcon className="h-4 w-4" />
					{actionData.message}
				</p>
			)}
			{actionData && "error" in actionData && actionData.error && (
				<p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
					{actionData.error}
				</p>
			)}

			<div className="grid gap-5 xl:grid-cols-2">
				{/* --- Thông tin shop ------------------------------------- */}
				<Section title="Thông tin shop">
					<Form method="post" className="space-y-4">
						<input type="hidden" name="intent" value="shop" />
						<Field label="Tên shop" name="shop_name" defaultValue={settings.shop_name} />
						<Field
							label="Khẩu hiệu"
							name="shop_tagline"
							defaultValue={settings.shop_tagline}
						/>
						<Field
							label="Hotline"
							name="shop_phone"
							defaultValue={settings.shop_phone}
							placeholder="0987654321"
						/>
						<Field label="Email" name="shop_email" defaultValue={settings.shop_email} />
						<Field label="Địa chỉ" name="shop_address" defaultValue={settings.shop_address} />
						<Field
							label="Tài khoản Threads"
							name="threads_handle"
							defaultValue={settings.threads_handle}
							placeholder="lumi.shop"
							hint="Không cần ký tự @"
						/>
						<button type="submit" className="btn-primary btn-md">
							Lưu thông tin
						</button>
					</Form>
				</Section>

				{/* --- Thanh toán ------------------------------------------ */}
				<Section title="Nhận tiền">
					<Form method="post" encType="multipart/form-data" className="space-y-4">
						<input type="hidden" name="intent" value="payment" />

						<Field
							label="Mã ngân hàng (VietQR)"
							name="bank_id"
							defaultValue={settings.bank_id}
							placeholder="VCB, TCB, MB, ACB..."
							hint="Dùng để tạo mã QR chuyển khoản tự điền số tiền và mã đơn"
						/>
						<Field
							label="Số tài khoản"
							name="bank_account_no"
							defaultValue={settings.bank_account_no}
						/>
						<Field
							label="Tên chủ tài khoản"
							name="bank_account_name"
							defaultValue={settings.bank_account_name}
							placeholder="NGUYEN THI THUY"
							hint="Viết in hoa, không dấu"
						/>

						<hr className="border-ink-100" />

						<Field label="Số MoMo" name="momo_phone" defaultValue={settings.momo_phone} />
						<Field
							label="Tên tài khoản MoMo"
							name="momo_name"
							defaultValue={settings.momo_name}
						/>

						<div>
							<span className="field-label">Ảnh QR MoMo</span>
							{settings.momo_qr_key ? (
								<div className="flex items-center gap-3">
									<img
										src={imageUrl(settings.momo_qr_key) ?? IMAGE_PLACEHOLDER}
										alt="Mã QR MoMo hiện tại"
										className="h-24 w-24 rounded-lg border border-ink-200 object-contain p-1"
									/>
									<label className="flex cursor-pointer items-center gap-1.5 text-sm text-red-600">
										<input type="checkbox" name="removeMomoQr" value="1" className="accent-red-500" />
										<TrashIcon className="h-4 w-4" />
										Gỡ ảnh này
									</label>
								</div>
							) : (
								<p className="mb-2 text-xs text-ink-400">
									Chưa có ảnh QR. Tải ảnh QR cá nhân từ app MoMo lên để khách quét.
								</p>
							)}
							<label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-ink-200 px-4 py-4 text-sm hover:border-brand-300">
								<UploadIcon className="h-5 w-5 text-brand-400" />
								Chọn ảnh QR mới
								<input type="file" name="momo_qr" accept="image/*" className="sr-only" />
							</label>
						</div>

						<button type="submit" className="btn-primary btn-md">
							Lưu thông tin thanh toán
						</button>
					</Form>
				</Section>

				{/* --- Vận chuyển ------------------------------------------ */}
				<Section title="Vận chuyển & đổi trả">
					<Form method="post" className="space-y-4">
						<input type="hidden" name="intent" value="shipping" />
						<Field
							label="Phí vận chuyển mặc định (đ)"
							name="shipping_fee"
							defaultValue={settings.shipping_fee}
							inputMode="numeric"
						/>
						<Field
							label="Miễn phí ship cho đơn từ (đ)"
							name="free_shipping_threshold"
							defaultValue={settings.free_shipping_threshold}
							inputMode="numeric"
							hint="Đặt 0 nếu không áp dụng"
						/>
						<Field
							label="Thời gian giữ hàng chờ chuyển khoản (phút)"
							name="order_hold_minutes"
							defaultValue={settings.order_hold_minutes}
							inputMode="numeric"
							hint="Quá hạn, đơn tự huỷ và hàng trả lại kho"
						/>
						<Field
							label="Số ngày đổi trả"
							name="return_policy_days"
							defaultValue={settings.return_policy_days}
							inputMode="numeric"
						/>
						<button type="submit" className="btn-primary btn-md">
							Lưu
						</button>
					</Form>
				</Section>

				{/* --- Danh mục -------------------------------------------- */}
				<Section title="Danh mục sản phẩm">
					<Form method="post" className="mb-4 flex flex-wrap items-end gap-2">
						<input type="hidden" name="intent" value="category-add" />
						<div className="min-w-40 flex-1">
							<label htmlFor="categoryName" className="field-label">
								Tên danh mục
							</label>
							<input
								id="categoryName"
								name="categoryName"
								placeholder="Váy"
								className="field !py-2"
							/>
						</div>
						<div>
							<label htmlFor="targetGroup" className="field-label">
								Nhóm
							</label>
							<select id="targetGroup" name="targetGroup" className="field !w-auto !py-2">
								{(Object.keys(TARGET_GROUPS) as TargetGroup[]).map((group) => (
									<option key={group} value={group}>
										{TARGET_GROUPS[group].label}
									</option>
								))}
							</select>
						</div>
						<button type="submit" className="btn-outline btn-md">
							Thêm
						</button>
					</Form>

					{(Object.keys(TARGET_GROUPS) as TargetGroup[]).map((group) => (
						<div key={group} className="mb-4 last:mb-0">
							<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
								{TARGET_GROUPS[group].label}
							</p>
							<div className="flex flex-wrap gap-2">
								{categories.filter((category) => category.target_group === group).length ===
								0 ? (
									<p className="text-sm text-ink-400">Chưa có danh mục nào.</p>
								) : (
									categories
										.filter((category) => category.target_group === group)
										.map((category) => (
											<Form key={category.id} method="post">
												<input type="hidden" name="intent" value="category-toggle" />
												<input type="hidden" name="categoryId" value={category.id} />
												<button type="submit" className="chip" title="Bấm để ẩn/hiện">
													{category.name}
												</button>
											</Form>
										))
								)}
							</div>
						</div>
					))}
					<p className="text-xs text-ink-400">
						Danh mục đã ẩn không hiện trong danh sách này. Mở lại bằng cách thêm danh mục
						cùng tên.
					</p>
				</Section>

				{/* --- Telegram --------------------------------------------- */}
				<section id="telegram" className="card p-4 lg:p-5 xl:col-span-2">
					<h2 className="font-semibold text-ink-900">Báo đơn mới qua Telegram</h2>
					<p className="mb-4 text-xs text-ink-400">
						Miễn phí hoàn toàn, không cần giấy phép kinh doanh. Mỗi đơn mới sẽ báo về
						điện thoại bạn trong vài giây, kèm tên khách, số điện thoại và địa chỉ.
					</p>

					<div className="grid gap-5 lg:grid-cols-2">
						<Form method="post" className="space-y-4">
							<input type="hidden" name="intent" value="telegram" />

							<ol className="space-y-1 rounded-xl bg-ink-50 p-3 text-xs text-ink-600">
								<li>1. Mở Telegram, nhắn <strong>@BotFather</strong>, gõ <code>/newbot</code></li>
								<li>2. Đặt tên bot, BotFather trả về một token dạng <code>123456:ABC-…</code></li>
								<li>3. Dán token vào ô dưới và lưu</li>
								<li>4. <strong>Nhắn cho bot vừa tạo một câu bất kỳ</strong>, rồi bấm “Dò cuộc trò chuyện”</li>
							</ol>

							<div>
								<label htmlFor="telegram_bot_token" className="field-label">
									Token bot
								</label>
								<input
									id="telegram_bot_token"
									name="telegram_bot_token"
									type="password"
									autoComplete="off"
									placeholder={telegramKeySet ? "Đã lưu — dán token mới để thay" : "123456:ABC-DEF..."}
									className="field"
								/>
							</div>

							<Field
								label="Chat ID"
								name="telegram_chat_id"
								defaultValue={settings.telegram_chat_id}
								placeholder="Bấm Dò cuộc trò chuyện để lấy"
							/>

							<button type="submit" className="btn-primary btn-md">
								Lưu cấu hình Telegram
							</button>
						</Form>

						<div className="space-y-3">
							{telegramKeySet ? (
								<>
									<Link to="?chat=1#telegram" className="btn-outline btn-md">
										Dò cuộc trò chuyện
									</Link>

									{telegramError && (
										<p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
											{telegramError}
										</p>
									)}

									{telegramChats.length > 0 && (
										<Form method="post" className="space-y-2">
											<input type="hidden" name="intent" value="telegram" />
											<span className="field-label">Chọn nơi nhận tin</span>
											<select
												name="telegram_chat_id"
												defaultValue={settings.telegram_chat_id}
												className="field !py-2 text-sm"
											>
												{telegramChats.map((chat) => (
													<option key={chat.id} value={chat.id}>
														{chat.name} ({chat.id})
													</option>
												))}
											</select>
											<button type="submit" className="btn-outline btn-md">
												Dùng cuộc trò chuyện này
											</button>
										</Form>
									)}

									{settings.telegram_chat_id && (
										<Form method="post">
											<input type="hidden" name="intent" value="telegram-test" />
											<button type="submit" className="btn-outline btn-md">
												Gửi tin thử
											</button>
										</Form>
									)}
								</>
							) : (
								<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
									Lưu token bot trước, rồi mới dò được cuộc trò chuyện.
								</p>
							)}
						</div>
					</div>
				</section>

				{/* --- Email ------------------------------------------------ */}
				<section id="email" className="card p-4 lg:p-5 xl:col-span-2">
					<h2 className="font-semibold text-ink-900">Email xác nhận đơn</h2>
					<p className="mb-4 text-xs text-ink-400">
						Khách để lại email khi đặt hàng sẽ nhận thư xác nhận kèm mã QR chuyển khoản.
						Chủ shop nhận thư báo đơn mới. Dùng Resend — miễn phí 3.000 thư/tháng.
					</p>

					<div className="grid gap-5 lg:grid-cols-2">
						<Form method="post" className="space-y-4">
							<input type="hidden" name="intent" value="email" />
							<div>
								<label htmlFor="resend_api_key" className="field-label">
									API key Resend
								</label>
								<input
									id="resend_api_key"
									name="resend_api_key"
									type="password"
									autoComplete="off"
									placeholder={resendKeySet ? "Đã lưu — dán khoá mới để thay" : "re_..."}
									className="field"
								/>
								<p className="mt-1 text-xs text-ink-400">
									Lấy ở resend.com → API Keys.
									{resendKeySet && " Khoá đã lưu và không hiển thị lại."}
								</p>
							</div>

							<Field
								label="Địa chỉ gửi"
								name="email_from"
								defaultValue={settings.email_from}
								placeholder="Lumi &lt;donhang@tenmien.com&gt;"
								hint="Domain phải được xác minh trong Resend, nếu không thư sẽ bị từ chối"
							/>
							<Field
								label="Email nhận báo đơn mới"
								name="email_owner"
								type="email"
								defaultValue={settings.email_owner}
								placeholder="ban@email.com"
								hint="Để trống thì không gửi thông báo cho chủ shop"
							/>

							<button type="submit" className="btn-primary btn-md">
								Lưu cấu hình email
							</button>
						</Form>

						<Form method="post" className="space-y-3">
							<input type="hidden" name="intent" value="email-test" />
							<span className="field-label">Gửi thử</span>
							<p className="text-xs text-ink-400">
								Gửi một thư mẫu để kiểm tra khoá và địa chỉ gửi có hoạt động không.
							</p>
							<div className="flex flex-wrap gap-2">
								<input
									name="testTo"
									type="email"
									placeholder="dia-chi-nhan@email.com"
									defaultValue={settings.email_owner}
									className="field !py-2 text-sm"
								/>
								<button type="submit" className="btn-outline btn-md shrink-0">
									Gửi thử
								</button>
							</div>
							<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
								Chưa có domain riêng thì Resend chỉ cho gửi tới chính email đã đăng ký
								tài khoản. Muốn gửi cho khách phải xác minh một domain.
							</p>
						</Form>
					</div>
				</section>

				{/* --- Threads / Typefully --------------------------------- */}
				<section id="threads" className="card p-4 lg:p-5 xl:col-span-2">
					<h2 className="font-semibold text-ink-900">Đăng bài Threads</h2>
					<p className="mb-4 text-xs text-ink-400">
						Đi qua Typefully nên không phải đăng ký Meta Developer app và chờ xét duyệt.
						Lấy API key trong Typefully: Settings → API.
					</p>

					<div className="grid gap-5 lg:grid-cols-2">
						<div className="space-y-5">
							<Form method="post" className="space-y-3">
								<input type="hidden" name="intent" value="threads-key" />
								<div>
									<label htmlFor="typefully_api_key" className="field-label">
										API key Typefully
									</label>
									<input
										id="typefully_api_key"
										name="typefully_api_key"
										type="password"
										autoComplete="off"
										placeholder={apiKeySet ? "Đã lưu — dán khoá mới để thay" : "Dán API key vào đây"}
										className="field"
									/>
									<p className="mt-1 text-xs text-ink-400">
										{apiKeySet
											? "Khoá đã lưu và không bao giờ hiển thị lại."
											: "Khoá được kiểm tra với Typefully trước khi lưu."}
									</p>
								</div>
								<button type="submit" className="btn-primary btn-md">
									{apiKeySet ? "Thay khoá" : "Kiểm tra & lưu khoá"}
								</button>
							</Form>

							{apiKeySet && (
								<div className="border-t border-ink-100 pt-4">
									<span className="field-label">Tài khoản đăng bài</span>
									{settings.typefully_social_set_name && (
										<p className="mb-2 flex items-center gap-1.5 text-sm text-ink-700">
											<CheckIcon className="h-4 w-4 text-green-600" />
											{settings.typefully_social_set_name}
										</p>
									)}

									{socialSetsError && (
										<p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
											{socialSetsError}
										</p>
									)}

									{socialSets.length > 0 ? (
										<Form method="post" className="flex flex-wrap gap-2">
											<input type="hidden" name="intent" value="threads-account" />
											<select name="socialSet" className="field !w-auto !py-2 text-sm">
												{socialSets.map((set) => (
													<option key={set.id} value={`${set.id}|${set.name || set.username}`}>
														{set.name || set.username} (@{set.username})
													</option>
												))}
											</select>
											<button type="submit" className="btn-outline btn-md">
												Chọn
											</button>
										</Form>
									) : (
										<Link to="?tai-khoan=1#threads" className="btn-outline btn-sm">
											Nạp danh sách tài khoản
										</Link>
									)}
								</div>
							)}
						</div>

						<Form method="post" className="space-y-3">
							<input type="hidden" name="intent" value="threads-template" />
							<div>
								<label htmlFor="threads_caption_template" className="field-label">
									Mẫu caption
								</label>
								<textarea
									id="threads_caption_template"
									name="threads_caption_template"
									rows={9}
									defaultValue={settings.threads_caption_template}
									className="field font-mono text-sm"
								/>
								<p className="mt-1.5 text-xs text-ink-400">
									Ô trống sẽ tự biến mất khỏi bài đăng. Các từ khoá thay được:
								</p>
								<div className="mt-1.5 flex flex-wrap gap-1.5">
									{THREADS_PLACEHOLDERS.map((item) => (
										<span
											key={item.token}
											title={item.label}
											className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-600"
										>
											{item.token}
										</span>
									))}
								</div>
							</div>

							<label className="flex items-start gap-2.5">
								<input
									type="checkbox"
									name="threads_auto_post"
									defaultChecked={settings.threads_auto_post === "1"}
									className="mt-0.5 h-4.5 w-4.5 accent-brand-500"
								/>
								<span className="text-sm">
									<span className="block font-medium text-ink-800">
										Tự đăng khi thêm sản phẩm mới
									</span>
									<span className="block text-xs text-ink-400">
										Sản phẩm vừa tạo sẽ lên Threads ngay, không cần bấm thêm
									</span>
								</span>
							</label>

							<button type="submit" className="btn-primary btn-md">
								Lưu mẫu caption
							</button>
						</Form>
					</div>
				</section>

				{/* --- Mật khẩu -------------------------------------------- */}
				<Section title="Đổi mật khẩu">
					<Form method="post" className="space-y-4">
						<input type="hidden" name="intent" value="password" />
						<Field
							label="Mật khẩu hiện tại"
							name="currentPassword"
							type="password"
							autoComplete="current-password"
						/>
						<Field
							label="Mật khẩu mới"
							name="newPassword"
							type="password"
							autoComplete="new-password"
							hint="Ít nhất 8 ký tự"
						/>
						<Field
							label="Xác nhận mật khẩu mới"
							name="confirmPassword"
							type="password"
							autoComplete="new-password"
						/>
						<button type="submit" className="btn-primary btn-md">
							Đổi mật khẩu
						</button>
						<p className="text-xs text-ink-400">
							Sau khi đổi, mọi thiết bị đang đăng nhập sẽ phải đăng nhập lại.
						</p>
					</Form>
				</Section>
			</div>
		</>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="card p-4 lg:p-5">
			<h2 className="mb-4 font-semibold text-ink-900">{title}</h2>
			{children}
		</section>
	);
}

function Field({
	label,
	name,
	hint,
	...props
}: {
	label: string;
	name: string;
	hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
	return (
		<div>
			<label htmlFor={name} className="field-label">
				{label}
			</label>
			<input id={name} name={name} className="field" {...props} />
			{hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
		</div>
	);
}
