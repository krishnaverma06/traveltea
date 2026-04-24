import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Receipt, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DashboardNav from "@/components/DashboardNav";
import TransactionRow from "@/components/TransactionRow";
import { getToken, apiListTransactions } from "@/lib/api";

const PAGE_SIZE = 20;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "succeeded", label: "Succeeded" },
  { id: "failed", label: "Failed" },
];

/**
 * Full payment history, paginated.
 *
 * Split out of the Profile page, where the whole list rendered inline and grew
 * without bound — by design it only ever grows, so it pushed the rest of the
 * page (settings, personal details) further out of reach with every booking.
 * Profile now shows a short summary and links here.
 */
export default function TransactionsPage() {
  const navigate = useNavigate();

  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({ current: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    if (!token) {
      setError("Please log in to view your payments.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    apiListTransactions(token, { page, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setTransactions(res.transactions || []);
        setPagination(res.pagination || { current: page, pages: 1, total: 0 });
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Couldn't load your payments.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page]);

  // Filtering is client-side over the current page only — the endpoint has no
  // status filter, and inventing one client-side across pages would show a
  // misleading count. The label says "on this page" for that reason.
  const visible =
    filter === "all" ? transactions : transactions.filter((t) => t.status === filter);

  const succeeded = transactions.filter((t) => t.status === "succeeded");
  const pageTotal = succeeded.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const currency = succeeded.find((t) => t.currency)?.currency || "";

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-purple-50/30">
      <DashboardNav />

      <div className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/profile")}
            className="text-gray-600 hover:text-gray-900 hover:bg-white/50 group normal-case tracking-normal"
          >
            <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
            Back to Profile
          </Button>
          <div className="h-6 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent" />
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              Payments
            </h1>
            {pagination.total > 0 && (
              <p className="text-xs text-gray-500">
                {pagination.total} transaction{pagination.total === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {error && (
          <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {!error && !isLoading && transactions.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    filter === f.id
                      ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow"
                      : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {pageTotal > 0 && (
              <p className="text-sm text-gray-600">
                Paid on this page:{" "}
                <span className="font-bold text-gray-900">
                  {currency} {pageTotal.toFixed(2)}
                </span>
              </p>
            )}
          </div>
        )}

        <Card className="p-6 bg-white border border-gray-200">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">
                {transactions.length === 0 ? "No payments yet." : "Nothing matches that filter."}
              </p>
              {transactions.length === 0 && (
                <p className="text-sm text-gray-500 mt-1">
                  Book a flight or hotel and it will show up here.
                </p>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {visible.map((t) => (
                <TransactionRow key={t._id || t.transactionId} transaction={t} />
              ))}
            </div>
          )}
        </Card>

        {pagination.pages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              className="normal-case tracking-normal text-gray-700"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm text-gray-600">
              Page {pagination.current} of {pagination.pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.pages || isLoading}
              onClick={() => setPage((p) => Math.min(p + 1, pagination.pages))}
              className="normal-case tracking-normal text-gray-700"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
