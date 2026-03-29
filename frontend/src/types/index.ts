// Định nghĩa TypeScript types cho toàn bộ hệ thống
export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: 'admin' | 'manager' | 'sales' | 'technician' | 'accountant' | 'warehouse';
  is_active: boolean;
  avatar_url?: string;
}

export interface Customer {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string;
  email?: string;
  id_card?: string;         // CCCD / CMND
  date_of_birth?: string;   // YYYY-MM-DD
  address?: string;
  province?: string;
  district?: string;
  customer_type: 'individual' | 'business';
  company_name?: string;    // Chỉ có khi là doanh nghiệp
  tax_code?: string;        // Mã số thuế doanh nghiệp
  notes?: string;
  loyalty_points: number;
  created_at: string;
  updated_at?: string;
}

export interface VehicleVariant {
  ten: string;       // VD: "Tiêu Chuẩn", "Cao Cấp", "Đặc Biệt"
  gia_chen_them: number; // chênh lệch so với giá bán cơ bản (0 = giá gốc)
}

export interface VehicleModel {
  id: string;
  brand: string;
  model_name: string;
  category: 'xe_may' | 'xe_dap' | 'xe_ba_banh' | 'xe_tay_ga';
  year?: number;
  price_cost: number;
  price_sell: number;
  battery_capacity?: string;         // tương thích field cũ
  battery_capacity_kwh?: number;
  battery_type?: string;
  max_range?: number;
  range_km?: number;
  max_speed_kmh?: number;
  warranty_months: number;
  image_url?: string;
  description?: string;
  is_active?: boolean;
  available_colors?: string[];       // mảng màu: ['Trắng', 'Đen', 'Đỏ']
  variants?: VehicleVariant[];       // phiên bản: [{ten, gia_chen_them}]
  created_at?: string;
  updated_at?: string;
}

export interface InventoryVehicle {
  id: string;
  vehicle_model_id: string;
  vin: string;
  engine_number?: string;
  battery_serial?: string;
  color: string;
  year_manufacture?: number;
  status: 'in_stock' | 'sold' | 'warranty_repair' | 'demo' | 'reserved';
  import_date?: string;
  import_price?: number;
  notes?: string;
  vehicle_models?: VehicleModel;
}

export interface SalesOrder {
  id: string;
  order_number: string;
  customer_id: string;
  salesperson_id: string;
  status: 'draft' | 'confirmed' | 'deposit_paid' | 'full_paid' | 'delivered' | 'cancelled';
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  payment_method: 'cash' | 'bank_transfer' | 'installment' | 'mixed';
  deposit_amount: number;
  delivery_date?: string;
  order_date: string;
  customers?: { full_name: string; phone: string };
  users?: { full_name: string };
}

export interface WarrantyRecord {
  id: string;
  warranty_number: string;
  customer_id: string;
  inventory_vehicle_id: string;
  start_date: string;
  end_date: string;
  status: 'active' | 'expired' | 'voided';
  customers?: { full_name: string; phone: string };
  inventory_vehicles?: {
    vin: string; color: string;
    vehicle_models?: { brand: string; model_name: string };
  };
}

export interface ServiceRequest {
  id: string;
  ticket_number: string;
  customer_id: string;
  inventory_vehicle_id?: string;
  service_type: 'warranty' | 'paid_repair' | 'periodic_maintenance' | 'upgrade';
  status: 'received' | 'diagnosing' | 'waiting_parts' | 'repairing' | 'done' | 'delivered' | 'cancelled';
  description?: string;
  technician_id?: string;
  labor_cost: number;
  parts_cost: number;
  received_date: string;
  customers?: { full_name: string; phone: string };
  users?: { full_name: string };
}

export interface FinanceTransaction {
  id: string;
  transaction_number: string;
  type: 'income' | 'expense';
  category: string;
  amount: number;
  payment_method: string;
  transaction_date: string;
  description?: string;
  reference_type?: string;
  users?: { full_name: string };
}

export interface DashboardStats {
  vehicles_in_stock: number;
  orders_this_month: number;
  open_service_tickets: number;
  low_stock_parts: number;
  revenue_this_month: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── Phụ kiện bán kèm theo xe ───────────────────────────────────────────────
export type AccessoryCategory = 'safety' | 'luggage' | 'comfort' | 'weather' | 'decor' | 'other';

export interface Accessory {
  id:                 string;
  code:               string;
  name:               string;
  description?:       string;
  category:           AccessoryCategory;
  image_url?:         string;
  price:              number;
  unit:               string;
  is_active:          boolean;
  compatible_models?: string[] | null; // null = tương thích tất cả xe
  created_at:         string;
  updated_at:         string;
}

// Item trong giỏ phụ kiện (state nội bộ POS)
export interface CartAccessory {
  accessory:  Accessory;
  quantity:   number;
  unit_price: number;   // snapshot giá tại thời điểm thêm
  line_total: number;   // quantity * unit_price
}

// Bản ghi đã lưu trong đơn hàng (khi fetch chi tiết)
export interface SalesOrderAccessory {
  id:           string;
  order_id:     string;
  accessory_id: string;
  quantity:     number;
  unit_price:   number;
  line_total:   number;
  created_at:   string;
  accessories?: Pick<Accessory, 'id' | 'code' | 'name' | 'category' | 'image_url' | 'unit' | 'price'>;
}
