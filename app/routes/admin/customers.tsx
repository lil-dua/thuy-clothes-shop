import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/customers";
import { EmptyState, PageHeader, Pagination, TableWrap } from "~/components/admin/ui";
import { SearchIcon } from "~/components/icons";
import { listCustomers } from "~/lib/db.server";
import { formatDate, formatVnd } from "~/lib/format";
import type { Customer } from "~/lib/types";

export function meta() {
	return [{ title: "Khách hàng — Lumi Admin" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
	const url = new URL(request.url);
	const result = await listCustomers(context.cloudflare.env.DB, {
		search: url.searchParams.get("q")?.trim() || null,
		page: Number.parseInt(url.searchParams.get("trang") ?? "1", 10) || 1,
		perPage: 20,
	});
	return { ...result, items: result.items as unknown as Customer[] };
}

export default function AdminCustomers({ loaderData }: Route.ComponentProps) {
	const { items, total, page, perPage } = loaderData;
	const [searchParams] = useSearchParams();

	const buildLink = (targetPage: number) => {
		const next = new URLSearchParams(searchParams);
		next.set("trang", String(targetPage));
		return `?${next.toString()}`;
	};

	return (
		<>
			<PageHeader
				title="Khách hàng"
				description={`${total} khách đã từng đặt hàng — nhận diện theo số điện thoại`}
			/>

			<Form method="get" className="mb-4 flex gap-2.5">
				<div className="relative min-w-52 flex-1">
					<SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
					<input
						type="search"
						name="q"
						defaultValue={searchParams.get("q") ?? ""}
						placeholder="Tên hoặc số điện thoại..."
						className="field !py-2 pl-9 text-sm"
					/>
				</div>
				<button type="submit" className="btn-outline btn-md">
					Tìm
				</button>
			</Form>

			<TableWrap>
				{items.length === 0 ? (
					<EmptyState
						title="Chưa có khách hàng nào"
						description="Khách được tạo tự động khi đặt đơn đầu tiên — không cần đăng ký tài khoản."
					/>
				) : (
					<table className="w-full min-w-[46rem] text-sm">
						<thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
							<tr>
								<th className="px-4 py-2.5 font-semibold">Khách hàng</th>
								<th className="px-4 py-2.5 font-semibold">Địa chỉ gần nhất</th>
								<th className="px-4 py-2.5 text-right font-semibold">Số đơn</th>
								<th className="px-4 py-2.5 text-right font-semibold">Tổng chi tiêu</th>
								<th className="px-4 py-2.5 font-semibold">Khách từ</th>
								<th className="px-4 py-2.5 text-right font-semibold">Đơn hàng</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-ink-100">
							{items.map((customer) => (
								<tr key={customer.id} className="hover:bg-ink-50/60">
									<td className="px-4 py-2.5">
										<span className="block font-medium text-ink-800">
											{customer.name ?? "Khách lẻ"}
										</span>
										<span className="text-xs text-ink-400">{customer.phone}</span>
									</td>
									<td className="max-w-xs px-4 py-2.5">
										<span className="line-clamp-2 text-xs text-ink-500">
											{customer.address ?? "—"}
										</span>
									</td>
									<td className="px-4 py-2.5 text-right text-ink-800">
										{customer.order_count}
									</td>
									<td className="px-4 py-2.5 text-right font-medium text-ink-800">
										{formatVnd(customer.total_spent)}
									</td>
									<td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-500">
										{formatDate(customer.created_at)}
									</td>
									<td className="px-4 py-2.5 text-right">
										<Link
											to={`/admin/don-hang?q=${encodeURIComponent(customer.phone ?? "")}`}
											className="text-sm font-medium text-brand-600 hover:underline"
										>
											Xem đơn
										</Link>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}

				<Pagination page={page} pageCount={Math.ceil(total / perPage)} buildLink={buildLink} />
			</TableWrap>
		</>
	);
}
