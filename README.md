# Ngày Mình Đi

Trang single-page lên kế hoạch du lịch với lịch xem tháng/năm và không gian riêng cho từng ngày: kế hoạch, ghi chú dạng cây, lịch trình, bảng chi tiêu và ảnh. Ứng dụng chạy thuần HTML/CSS/JavaScript, không cần backend riêng.

## Chạy giao diện

Có thể mở `index.html` để xem giao diện và dùng chế độ lưu cục bộ. Đăng nhập Google chỉ hoạt động trên origin HTTP đã đăng ký, không hoạt động khi mở bằng `file://`.

## Deploy trên GitHub Pages

Repo `ctpspeedtech/plandulich` dùng GitHub Actions để deploy mỗi khi có commit mới lên nhánh `main`. Nếu cần, vào **Settings → Pages → Build and deployment** và chọn **GitHub Actions** làm nguồn deploy. Repo private cần gói GitHub hỗ trợ Pages cho repo private.

Sau khi workflow chạy thành công, trang sẽ ở:

`https://ctpspeedtech.github.io/plandulich/`

## Bật đăng nhập Google và đồng bộ Drive

1. Trong project Google Cloud gắn với Client ID hiện có trong `app.js`, bật **Google Drive API** và cấu hình OAuth consent screen.
2. Mở OAuth Client ID loại **Web application**, thêm các origin sau vào **Authorized JavaScript origins**:
   - `http://localhost:8000` để chạy local.
   - `https://ctpspeedtech.github.io` để dùng trên GitHub Pages. Không thêm `/plandulich/` vào origin.
3. Nếu consent screen đang ở chế độ **Testing**, thêm từng tài khoản Google cần thử vào danh sách **Test users**. Chỉ các tài khoản này mới đăng nhập được khi ứng dụng ở chế độ Testing. Để mở cho người dùng khác, chuyển ứng dụng sang production và hoàn tất các yêu cầu xác minh OAuth của Google nếu được yêu cầu.
4. Chạy local bằng `python -m http.server 8000`, rồi truy cập `http://localhost:8000`.

Ứng dụng chỉ yêu cầu scope `drive.appdata`; kế hoạch và ảnh được lưu trong `appDataFolder` riêng của tài khoản Google đang đăng nhập, không hiển thị trong danh sách tệp Drive thông thường. Vì vậy mỗi tài khoản Google có dữ liệu riêng, không dùng chung database. Ảnh được thu nhỏ tối đa 1400 px trước khi lưu. Sau khi xác thực, dữ liệu local hiện có sẽ được thay bằng dữ liệu Drive nếu đã có bản lưu; nếu chưa có, ứng dụng khởi tạo dữ liệu Drive từ bản local.
