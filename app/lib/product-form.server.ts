/**
 * Đọc, kiểm tra và lưu biểu mẫu sản phẩm ở trang quản trị.
 * Dùng chung cho "Thêm sản phẩm" và "Sửa sản phẩm" để hai màn hình không
 * trôi lệch nhau về quy tắc kiểm tra dữ liệu.
 */

import { ensureUniqueSlug } from "./db.server";
import { parseVnd, slugify } from "./format";
import { uploadProductImage } from "./images.server";

export interface VariantInput {
	id: number | null;
	size: string;
	color: string | null;
	colorHex: string | null;
	sku: string | null;
	quantity: number;
}

export interface ProductFormValues {
	name: string;
	description: string | null;
	detail: string | null;
	categoryId: number | null;
	costPrice: number;
	salePrice: number;
	comparePrice: number | null;
	status: string;
	isFeatured: boolean;
	variants: VariantInput[];
}

export type ProductFormErrors = Partial<
	Record<"name" | "categoryId" | "salePrice" | "costPrice" | "variants" | "images" | "form", string>
>;

export function parseProductForm(form: FormData): {
	values: ProductFormValues;
	errors: ProductFormErrors;
} {
	const name = String(form.get("name") ?? "").trim();
	const categoryRaw = String(form.get("categoryId") ?? "");
	const categoryId = categoryRaw ? Number.parseInt(categoryRaw, 10) : null;
	const costPrice = parseVnd(String(form.get("costPrice") ?? ""));
	const salePrice = parseVnd(String(form.get("salePrice") ?? ""));
	const compareRaw = parseVnd(String(form.get("comparePrice") ?? ""));
	const status = String(form.get("status") ?? "active");

	const variants = parseVariants(form);

	const errors: ProductFormErrors = {};
	if (name.length < 2) errors.name = "Vui lòng nhập tên sản phẩm";
	if (!categoryId) errors.categoryId = "Chọn danh mục để phân loại đồ nữ / đồ trẻ em";
	if (salePrice <= 0) errors.salePrice = "Giá bán phải lớn hơn 0";
	if (costPrice < 0) errors.costPrice = "Giá nhập không hợp lệ";
	if (variants.length === 0) errors.variants = "Thêm ít nhất một size kèm số lượng";

	return {
		values: {
			name,
			description: String(form.get("description") ?? "").trim() || null,
			detail: String(form.get("detail") ?? "").trim() || null,
			categoryId,
			costPrice,
			salePrice,
			// Giá gốc chỉ có ý nghĩa khi cao hơn giá bán (để gạch ngang)
			comparePrice: compareRaw > salePrice ? compareRaw : null,
			status: ["active", "hidden", "discontinued"].includes(status) ? status : "active",
			isFeatured: form.get("isFeatured") === "on",
			variants,
		},
		errors,
	};
}

function parseVariants(form: FormData): VariantInput[] {
	const ids = form.getAll("variantId");
	const sizes = form.getAll("variantSize");
	const colors = form.getAll("variantColor");
	const hexes = form.getAll("variantHex");
	const skus = form.getAll("variantSku");
	const quantities = form.getAll("variantQty");

	const seen = new Set<string>();
	const variants: VariantInput[] = [];

	for (let index = 0; index < sizes.length; index++) {
		const size = String(sizes[index] ?? "").trim();
		if (!size) continue; // dòng trống — chủ shop thêm rồi bỏ dở

		const color = String(colors[index] ?? "").trim() || null;
		// Ràng buộc UNIQUE(product_id, size, color) không chặn được trùng khi
		// color là NULL, nên phải tự loại trùng ở đây.
		const key = `${size.toLowerCase()}|${(color ?? "").toLowerCase()}`;
		if (seen.has(key)) continue;
		seen.add(key);

		const rawId = String(ids[index] ?? "");
		variants.push({
			id: rawId ? Number.parseInt(rawId, 10) : null,
			size,
			color,
			colorHex: String(hexes[index] ?? "").trim() || null,
			sku: String(skus[index] ?? "").trim() || null,
			quantity: Math.max(0, Number.parseInt(String(quantities[index] ?? "0"), 10) || 0),
		});
	}

	return variants;
}

export async function saveProduct(
	db: D1Database,
	bucket: R2Bucket,
	form: FormData,
	values: ProductFormValues,
	productId?: number,
): Promise<{ ok: true; id: number; slug: string } | { ok: false; errors: ProductFormErrors }> {
	const slug = await ensureUniqueSlug(db, slugify(values.name), productId);

	// --- 1. Sản phẩm ------------------------------------------------------
	let id = productId;
	if (id) {
		await db
			.prepare(
				`UPDATE products SET
				   slug = ?2, name = ?3, description = ?4, detail = ?5, category_id = ?6,
				   cost_price = ?7, sale_price = ?8, compare_price = ?9, status = ?10,
				   is_featured = ?11, updated_at = datetime('now')
				 WHERE id = ?1`,
			)
			.bind(
				id,
				slug,
				values.name,
				values.description,
				values.detail,
				values.categoryId,
				values.costPrice,
				values.salePrice,
				values.comparePrice,
				values.status,
				values.isFeatured ? 1 : 0,
			)
			.run();
	} else {
		const inserted = await db
			.prepare(
				`INSERT INTO products
				   (slug, name, description, detail, category_id, cost_price, sale_price,
				    compare_price, status, is_featured)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
				 RETURNING id`,
			)
			.bind(
				slug,
				values.name,
				values.description,
				values.detail,
				values.categoryId,
				values.costPrice,
				values.salePrice,
				values.comparePrice,
				values.status,
				values.isFeatured ? 1 : 0,
			)
			.first<{ id: number }>();
		if (!inserted) return { ok: false, errors: { form: "Không lưu được sản phẩm" } };
		id = inserted.id;
	}

	// --- 2. Biến thể (size/màu) ------------------------------------------
	const keptIds = values.variants
		.map((variant) => variant.id)
		.filter((value): value is number => value != null);

	const statements: D1PreparedStatement[] = [];

	// Dọn các size đã bị bỏ TRƯỚC khi thêm/sửa.
	// Nếu làm ngược lại, mệnh đề "id NOT IN (danh sách giữ lại)" sẽ quét trúng
	// cả dòng vừa INSERT (id mới chưa có trong danh sách) và xoá mất nó.
	if (productId) {
		const keepClause = keptIds.length
			? `AND id NOT IN (${keptIds.map((_, index) => `?${index + 2}`).join(", ")})`
			: "";
		// Size bị bỏ đi: ẩn thay vì xoá, vì order_items cũ còn tham chiếu tới nó.
		statements.push(
			db
				.prepare(
					`UPDATE product_variants SET is_active = 0, quantity = 0
					 WHERE product_id = ?1 ${keepClause}`,
				)
				.bind(productId, ...keptIds),
		);
		// Xoá cứng chỉ áp dụng cho biến thể chưa từng xuất hiện trong đơn nào.
		statements.push(
			db
				.prepare(
					`DELETE FROM product_variants
					 WHERE product_id = ?1 AND is_active = 0
					   AND id NOT IN (SELECT product_variant_id FROM order_items
					                  WHERE product_variant_id IS NOT NULL)`,
				)
				.bind(productId),
		);
	}

	values.variants.forEach((variant, index) => {
		if (variant.id) {
			statements.push(
				db
					.prepare(
						`UPDATE product_variants SET
						   size = ?2, color = ?3, color_hex = ?4, sku = ?5, quantity = ?6,
						   sort_order = ?7, is_active = 1
						 WHERE id = ?1 AND product_id = ?8`,
					)
					.bind(
						variant.id,
						variant.size,
						variant.color,
						variant.colorHex,
						variant.sku,
						variant.quantity,
						index,
						id,
					),
			);
		} else {
			statements.push(
				db
					.prepare(
						`INSERT INTO product_variants
						   (product_id, size, color, color_hex, sku, quantity, sort_order)
						 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
						 ON CONFLICT (product_id, size, color) DO UPDATE SET
						   color_hex = excluded.color_hex,
						   sku = excluded.sku,
						   quantity = excluded.quantity,
						   sort_order = excluded.sort_order,
						   is_active = 1`,
					)
					.bind(
						id,
						variant.size,
						variant.color,
						variant.colorHex,
						variant.sku,
						variant.quantity,
						index,
					),
			);
		}
	});

	if (statements.length > 0) await db.batch(statements);

	// --- 3. Ảnh ------------------------------------------------------------
	const imageError = await saveImages(db, bucket, form, id, slug);
	if (imageError) return { ok: false, errors: { images: imageError } };

	return { ok: true, id, slug };
}

async function saveImages(
	db: D1Database,
	bucket: R2Bucket,
	form: FormData,
	productId: number,
	slug: string,
): Promise<string | null> {
	// Xoá ảnh chủ shop bỏ chọn
	const deleteIds = form
		.getAll("deleteImageId")
		.map((value) => Number.parseInt(String(value), 10))
		.filter(Number.isInteger);

	for (const imageId of deleteIds) {
		const row = await db
			.prepare(`SELECT r2_key FROM product_images WHERE id = ?1 AND product_id = ?2`)
			.bind(imageId, productId)
			.first<{ r2_key: string }>();
		if (!row) continue;

		await db.prepare(`DELETE FROM product_images WHERE id = ?1`).bind(imageId).run();

		// Chỉ xoá tệp trong R2 khi không đơn cũ nào đang dùng ảnh này làm
		// ảnh đại diện — nếu không, lịch sử đơn sẽ hiện ảnh vỡ.
		const used = await db
			.prepare(`SELECT 1 AS hit FROM order_items WHERE image_r2_key = ?1 LIMIT 1`)
			.bind(row.r2_key)
			.first();
		if (!used) await bucket.delete(row.r2_key);
	}

	// Thêm ảnh mới
	const files = form.getAll("images").filter((value): value is File => value instanceof File);
	const maxOrder = await db
		.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM product_images WHERE product_id = ?1`)
		.bind(productId)
		.first<{ max_order: number }>();

	let order = (maxOrder?.max_order ?? -1) + 1;
	for (const file of files) {
		if (file.size === 0) continue;
		const upload = await uploadProductImage(bucket, file, slug);
		if (!upload.ok) return upload.error;

		await db
			.prepare(
				`INSERT INTO product_images (product_id, r2_key, sort_order) VALUES (?1, ?2, ?3)`,
			)
			.bind(productId, upload.key, order++)
			.run();
	}

	return null;
}
