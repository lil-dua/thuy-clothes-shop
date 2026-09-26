import { useId, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { PlusIcon, TrashIcon, UploadIcon } from "~/components/icons";
import { compressImage, formatBytes } from "~/lib/compress-image";
import { formatNumber, parseVnd } from "~/lib/format";
import { imageUrl, placeholderFor } from "~/lib/images";
import type { ProductFormErrors } from "~/lib/product-form.server";
import { TARGET_GROUPS, type Category, type ProductDetail, type TargetGroup } from "~/lib/types";

/** Gợi ý size theo nhóm đối tượng — nữ dùng S/M/L, trẻ em dùng tuổi */
const SIZE_PRESETS: Record<TargetGroup, string[]> = {
	women: ["S", "M", "L", "XL", "XXL", "Freesize"],
	kids: ["1-2T", "2-3T", "3-4T", "4-5T", "5-6T", "7-8T", "9-10T"],
};

interface VariantRow {
	key: string;
	id: number | null;
	size: string;
	color: string;
	colorHex: string;
	sku: string;
	quantity: string;
}

export function ProductForm({
	categories,
	product,
	errors = {},
	threadsToggle,
}: {
	categories: Category[];
	product?: ProductDetail;
	errors?: ProductFormErrors;
	/**
	 * Chỉ truyền ở màn thêm mới: cho phép đăng Threads ngay sau khi lưu.
	 * Màn sửa dùng khối ThreadsPanel riêng vì ở đó còn có lịch sử đăng.
	 */
	threadsToggle?: { available: boolean; defaultOn: boolean };
}) {
	const navigation = useNavigation();
	const submitting = navigation.state === "submitting";
	const formId = useId();

	const [categoryId, setCategoryId] = useState(String(product?.category_id ?? ""));
	const [rows, setRows] = useState<VariantRow[]>(() =>
		product && product.variants.length > 0
			? product.variants.map((variant, index) => ({
					key: `v${variant.id}-${index}`,
					id: variant.id,
					size: variant.size,
					color: variant.color ?? "",
					colorHex: variant.color_hex ?? "",
					sku: variant.sku ?? "",
					quantity: String(variant.quantity),
				}))
			: [blankRow()],
	);
	const [deletedImages, setDeletedImages] = useState<number[]>([]);

	// Nén ảnh ngay khi chọn, trước lúc gửi lên server
	const fileInput = useRef<HTMLInputElement>(null);
	const [compressing, setCompressing] = useState(false);
	const [picked, setPicked] = useState<{ count: number; before: number; after: number } | null>(null);

	async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
		const chosen = [...(event.target.files ?? [])];
		if (chosen.length === 0) return;

		setCompressing(true);
		try {
			const results = await Promise.all(chosen.map(compressImage));

			// Không gán trực tiếp được vào input.files, phải dựng lại FileList
			// qua DataTransfer thì biểu mẫu mới gửi đi bản đã nén.
			const transfer = new DataTransfer();
			for (const result of results) transfer.items.add(result.file);
			if (fileInput.current) fileInput.current.files = transfer.files;

			setPicked({
				count: results.length,
				before: results.reduce((sum, r) => sum + r.originalBytes, 0),
				after: results.reduce((sum, r) => sum + r.compressedBytes, 0),
			});
		} finally {
			setCompressing(false);
		}
	}

	const selectedGroup = categories.find(
		(category) => String(category.id) === categoryId,
	)?.target_group;
	const sizeSuggestions = selectedGroup ? SIZE_PRESETS[selectedGroup] : [];

	const updateRow = (key: string, patch: Partial<VariantRow>) =>
		setRows((current) =>
			current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
		);

	const totalStock = rows.reduce(
		(sum, row) => sum + (Number.parseInt(row.quantity, 10) || 0),
		0,
	);

	return (
		<Form method="post" encType="multipart/form-data" className="space-y-5">
			{errors.form && (
				<p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{errors.form}</p>
			)}

			<div className="grid gap-5 xl:grid-cols-3">
				{/* --- Cột trái: nội dung ------------------------------------ */}
				<div className="space-y-5 xl:col-span-2">
					<section className="card p-4 lg:p-5">
						<h2 className="mb-4 font-semibold text-ink-900">Thông tin cơ bản</h2>
						<div className="space-y-4">
							<div>
								<label htmlFor={`${formId}-name`} className="field-label">
									Tên sản phẩm <span className="text-brand-500">*</span>
								</label>
								<input
									id={`${formId}-name`}
									name="name"
									required
									defaultValue={product?.name}
									placeholder="Đầm hoa nhí tay bồng"
									className={`field ${errors.name ? "field-error" : ""}`}
								/>
								{errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
							</div>

							<div>
								<label htmlFor={`${formId}-category`} className="field-label">
									Danh mục <span className="text-brand-500">*</span>
								</label>
								<select
									id={`${formId}-category`}
									name="categoryId"
									value={categoryId}
									onChange={(event) => setCategoryId(event.target.value)}
									className={`field ${errors.categoryId ? "field-error" : ""}`}
								>
									<option value="">— Chọn danh mục —</option>
									{(Object.keys(TARGET_GROUPS) as TargetGroup[]).map((group) => (
										<optgroup key={group} label={TARGET_GROUPS[group].label}>
											{categories
												.filter((category) => category.target_group === group)
												.map((category) => (
													<option key={category.id} value={category.id}>
														{category.name}
													</option>
												))}
										</optgroup>
									))}
								</select>
								{errors.categoryId ? (
									<p className="mt-1 text-xs text-red-600">{errors.categoryId}</p>
								) : (
									<p className="mt-1 text-xs text-ink-400">
										Danh mục quyết định sản phẩm nằm ở mục Thời trang nữ hay Trẻ em.
									</p>
								)}
							</div>

							<div>
								<label htmlFor={`${formId}-description`} className="field-label">
									Mô tả ngắn
								</label>
								<textarea
									id={`${formId}-description`}
									name="description"
									rows={3}
									defaultValue={product?.description ?? ""}
									placeholder="Đầm hoa nhí với thiết kế tay bồng nữ tính, chất liệu voan mềm..."
									className="field"
								/>
							</div>

							<div>
								<label htmlFor={`${formId}-detail`} className="field-label">
									Thông tin chi tiết
								</label>
								<textarea
									id={`${formId}-detail`}
									name="detail"
									rows={3}
									defaultValue={product?.detail ?? ""}
									placeholder="Chất liệu: voan lót lụa&#10;Bảng size: S (45-50kg), M (50-55kg)&#10;Giặt máy ở chế độ nhẹ"
									className="field"
								/>
							</div>
						</div>
					</section>

					<section className="card p-4 lg:p-5">
						<h2 className="mb-1 font-semibold text-ink-900">Ảnh sản phẩm</h2>
						<p className="mb-4 text-xs text-ink-400">
							Ảnh đầu tiên là ảnh đại diện. Hỗ trợ JPG, PNG, WebP — tối đa 5MB mỗi ảnh.
						</p>

						{product && product.images.length > 0 && (
							<div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
								{product.images.map((image) => {
									const removed = deletedImages.includes(image.id);
									return (
										<div key={image.id} className="relative">
											<div
												className={`aspect-4/5 overflow-hidden rounded-lg bg-ink-100 ${removed ? "opacity-30" : ""}`}
											>
												<img
													src={
														imageUrl(image.r2_key) ??
														placeholderFor(product?.category_slug, product?.target_group)
													}
													alt=""
													className="h-full w-full object-cover"
												/>
											</div>
											{removed && <input type="hidden" name="deleteImageId" value={image.id} />}
											<button
												type="button"
												onClick={() =>
													setDeletedImages((current) =>
														removed
															? current.filter((id) => id !== image.id)
															: [...current, image.id],
													)
												}
												className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-ink-600 shadow hover:text-red-600"
												aria-label={removed ? "Khôi phục ảnh" : "Xoá ảnh"}
											>
												{removed ? (
													<PlusIcon className="h-3.5 w-3.5" />
												) : (
													<TrashIcon className="h-3.5 w-3.5" />
												)}
											</button>
										</div>
									);
								})}
							</div>
						)}

						<label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-ink-200 px-4 py-8 text-center hover:border-brand-300 hover:bg-brand-50/40">
							<UploadIcon className="h-6 w-6 text-brand-400" />
							<span className="text-sm font-medium text-ink-700">
								{compressing ? "Đang nén ảnh..." : "Thêm ảnh"}
							</span>
							<span className="text-xs text-ink-400">
								Chọn một hoặc nhiều ảnh — hệ thống tự thu nhỏ trước khi tải lên
							</span>
							<input
								ref={fileInput}
								type="file"
								name="images"
								accept="image/*"
								multiple
								onChange={handleFiles}
								className="sr-only"
							/>
						</label>

						{picked && (
							<p className="mt-2 text-xs text-green-700">
								Đã chọn {picked.count} ảnh · {formatBytes(picked.before)} →{" "}
								<strong>{formatBytes(picked.after)}</strong>
								{picked.before > picked.after &&
									` (nhẹ hơn ${Math.round((1 - picked.after / picked.before) * 100)}%)`}
							</p>
						)}
						{errors.images && <p className="mt-1 text-xs text-red-600">{errors.images}</p>}
					</section>
				</div>

				{/* --- Cột phải: giá & trạng thái ---------------------------- */}
				<div className="space-y-5">
					<section className="card p-4 lg:p-5">
						<h2 className="mb-4 font-semibold text-ink-900">Giá</h2>
						<div className="space-y-4">
							<MoneyField
								id={`${formId}-cost`}
								name="costPrice"
								label="Giá nhập"
								hint="Chỉ hiển thị trong trang quản trị, dùng để tính lợi nhuận"
								defaultValue={product?.cost_price ?? 0}
								error={errors.costPrice}
							/>
							<MoneyField
								id={`${formId}-sale`}
								name="salePrice"
								label="Giá bán"
								required
								defaultValue={product?.sale_price ?? 0}
								error={errors.salePrice}
							/>
							<MoneyField
								id={`${formId}-compare`}
								name="comparePrice"
								label="Giá gốc (gạch ngang)"
								hint="Để trống nếu không khuyến mãi"
								defaultValue={product?.compare_price ?? 0}
							/>
						</div>
					</section>

					<section className="card p-4 lg:p-5">
						<h2 className="mb-4 font-semibold text-ink-900">Hiển thị</h2>
						<div className="space-y-4">
							<div>
								<label htmlFor={`${formId}-status`} className="field-label">
									Trạng thái
								</label>
								<select
									id={`${formId}-status`}
									name="status"
									defaultValue={product?.status ?? "active"}
									className="field"
								>
									<option value="active">Đang bán</option>
									<option value="hidden">Ẩn khỏi website</option>
									<option value="discontinued">Ngừng kinh doanh</option>
								</select>
							</div>

							<label className="flex items-start gap-2.5">
								<input
									type="checkbox"
									name="isFeatured"
									defaultChecked={Boolean(product?.is_featured)}
									className="mt-0.5 h-4.5 w-4.5 accent-brand-500"
								/>
								<span className="text-sm">
									<span className="block font-medium text-ink-800">Sản phẩm nổi bật</span>
									<span className="block text-xs text-ink-400">
										Hiện ở mục "Sản phẩm nổi bật" trang chủ
									</span>
								</span>
							</label>

							{threadsToggle?.available && (
								<label className="flex items-start gap-2.5 border-t border-ink-100 pt-4">
									<input
										type="checkbox"
										name="postToThreads"
										defaultChecked={threadsToggle.defaultOn}
										className="mt-0.5 h-4.5 w-4.5 accent-brand-500"
									/>
									<span className="text-sm">
										<span className="block font-medium text-ink-800">
											Đăng lên Threads sau khi lưu
										</span>
										<span className="block text-xs text-ink-400">
											Caption sinh từ mẫu trong Cài đặt, kèm ảnh vừa tải lên
										</span>
									</span>
								</label>
							)}
						</div>
					</section>

					<section className="card p-4 lg:p-5">
						<p className="text-sm text-ink-500">Tổng tồn kho</p>
						<p className="mt-0.5 text-2xl font-bold text-ink-900">{totalStock}</p>
						<p className="mt-0.5 text-xs text-ink-400">cộng từ tất cả các size bên dưới</p>
					</section>
				</div>
			</div>

			{/* --- Size & tồn kho --------------------------------------------- */}
			<section className="card p-4 lg:p-5">
				<div className="mb-1 flex items-center justify-between">
					<h2 className="font-semibold text-ink-900">Thông tin size & tồn kho</h2>
					<button
						type="button"
						onClick={() => setRows((current) => [...current, blankRow()])}
						className="btn-outline btn-sm"
					>
						<PlusIcon className="h-4 w-4" />
						Thêm size
					</button>
				</div>
				<p className="mb-4 text-xs text-ink-400">
					Mỗi dòng là một tổ hợp size + màu với số lượng riêng.
					{sizeSuggestions.length > 0 && (
						<> Gợi ý size cho nhóm này: {sizeSuggestions.join(", ")}.</>
					)}
				</p>

				{errors.variants && (
					<p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
						{errors.variants}
					</p>
				)}

				<datalist id={`${formId}-sizes`}>
					{sizeSuggestions.map((size) => (
						<option key={size} value={size} />
					))}
				</datalist>

				<div className="overflow-x-auto">
					<table className="w-full min-w-[46rem] text-sm">
						<thead className="text-left text-xs uppercase tracking-wide text-ink-500">
							<tr>
								<th className="pb-2 font-semibold">Size</th>
								<th className="pb-2 font-semibold">Màu sắc</th>
								<th className="pb-2 font-semibold">Mã màu</th>
								<th className="pb-2 font-semibold">SKU</th>
								<th className="pb-2 font-semibold">Số lượng</th>
								<th className="pb-2" />
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr key={row.key}>
									<td className="py-1.5 pr-2">
										{row.id && <input type="hidden" name="variantId" value={row.id} />}
										{!row.id && <input type="hidden" name="variantId" value="" />}
										<input
											name="variantSize"
											list={`${formId}-sizes`}
											value={row.size}
											onChange={(event) => updateRow(row.key, { size: event.target.value })}
											placeholder="M"
											className="field !py-2"
										/>
									</td>
									<td className="py-1.5 pr-2">
										<input
											name="variantColor"
											value={row.color}
											onChange={(event) => updateRow(row.key, { color: event.target.value })}
											placeholder="Trắng"
											className="field !py-2"
										/>
									</td>
									<td className="py-1.5 pr-2">
										<div className="flex items-center gap-1.5">
											<input
												type="color"
												value={row.colorHex || "#ffffff"}
												onChange={(event) =>
													updateRow(row.key, { colorHex: event.target.value })
												}
												className="h-9 w-10 shrink-0 cursor-pointer rounded border border-ink-200"
												aria-label={`Mã màu cho ${row.color || "biến thể"}`}
											/>
											<input
												name="variantHex"
												value={row.colorHex}
												onChange={(event) =>
													updateRow(row.key, { colorHex: event.target.value })
												}
												placeholder="#FFFFFF"
												className="field !py-2"
											/>
										</div>
									</td>
									<td className="py-1.5 pr-2">
										<input
											name="variantSku"
											value={row.sku}
											onChange={(event) => updateRow(row.key, { sku: event.target.value })}
											placeholder="tuỳ chọn"
											className="field !py-2"
										/>
									</td>
									<td className="py-1.5 pr-2">
										<input
											name="variantQty"
											type="number"
											min={0}
											value={row.quantity}
											onChange={(event) =>
												updateRow(row.key, { quantity: event.target.value })
											}
											className="field !w-24 !py-2"
										/>
									</td>
									<td className="py-1.5">
										<button
											type="button"
											onClick={() =>
												setRows((current) =>
													current.length > 1
														? current.filter((item) => item.key !== row.key)
														: [blankRow()],
												)
											}
											className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
											aria-label="Xoá dòng"
										>
											<TrashIcon className="h-4 w-4" />
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<div className="flex justify-end gap-3">
				<Link to="/admin/san-pham" className="btn-ghost btn-md">
					Huỷ
				</Link>
				<button
					type="submit"
					disabled={submitting || compressing}
					className="btn-primary btn-md"
				>
					{compressing ? "Đang nén ảnh..." : submitting ? "Đang lưu..." : "Lưu sản phẩm"}
				</button>
			</div>
		</Form>
	);
}

function blankRow(): VariantRow {
	return {
		key: `new-${Math.random().toString(36).slice(2, 9)}`,
		id: null,
		size: "",
		color: "",
		colorHex: "",
		sku: "",
		quantity: "0",
	};
}

/**
 * Ô nhập tiền tự chèn dấu chấm hàng nghìn khi gõ — con số 6-7 chữ số rất dễ
 * gõ nhầm một số 0 nếu hiển thị trần.
 */
function MoneyField({
	id,
	name,
	label,
	hint,
	required,
	defaultValue,
	error,
}: {
	id: string;
	name: string;
	label: string;
	hint?: string;
	required?: boolean;
	defaultValue: number;
	error?: string;
}) {
	const [value, setValue] = useState(defaultValue ? formatNumber(defaultValue) : "");

	return (
		<div>
			<label htmlFor={id} className="field-label">
				{label} {required && <span className="text-brand-500">*</span>}
			</label>
			<div className="relative">
				<input
					id={id}
					name={name}
					inputMode="numeric"
					required={required}
					value={value}
					onChange={(event) => {
						const numeric = parseVnd(event.target.value);
						setValue(numeric ? formatNumber(numeric) : "");
					}}
					placeholder="0"
					className={`field pr-8 ${error ? "field-error" : ""}`}
				/>
				<span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
					đ
				</span>
			</div>
			{error ? (
				<p className="mt-1 text-xs text-red-600">{error}</p>
			) : (
				hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>
			)}
		</div>
	);
}
