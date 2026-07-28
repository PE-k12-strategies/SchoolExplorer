// Jeffco room schedule — same data as:
// https://jmmrsetieidkwycnfvkm.supabase.co/rest/v1/jeffco_room_schedule
// (requires signed-in approved user via dashboard; anon returns empty due to RLS)

window.JEFFCO_CONFIG = {
  table: 'jeffco_room_schedule',
  restUrl: 'https://jmmrsetieidkwycnfvkm.supabase.co/rest/v1/jeffco_room_schedule',
  columns: {
    schoolId: ['Facility_ID', 'facility_id', 'School_ID'],
    schoolName: ['Facility_Name', 'Facility_Na', 'School_Name'],
    roomType: ['Room_Type', 'room_type'],
    roomCategory: ['Room_Category', 'Room_Cate', 'room_category'],
    area: ['Area', 'area'],
  },
};
window.resolveJeffcoColumn = function (row, candidates) {
  if (!row) return null;
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return key;
  }
  return null;
};

window.getJeffcoField = function (row, field) {
  const key = window.resolveJeffcoColumn(row, window.JEFFCO_CONFIG.columns[field]);
  if (!key) return '';
  const value = row[key];
  return value == null ? '' : String(value).trim();
};
