<p align="center">
  <a href="../en/migration.md">English</a> | <a href="../ko/migration.md">한국어</a> | <a href="../de/migration.md">Deutsch</a> | <a href="../cn/migration.md">简体中文</a> | <a href="../es/migration.md">Español</a> | <strong>Tiếng Việt</strong> | <a href="../zh-Hant/migration.md">繁體中文</a>
</p>

# Hướng dẫn di chuyển từ RisuAI

> 🌐 Hướng dẫn này được dịch bằng máy. Để có thông tin chính xác nhất, vui lòng tham khảo phiên bản [tiếng Anh](../en/migration.md) hoặc [tiếng Hàn](../ko/migration.md).

Có bốn cách để di chuyển dữ liệu từ cài đặt RisuAI hiện có (RisuAI Web, RisuAI Cục bộ) sang PocketRisu. Chọn dựa trên môi trường nguồn và kích thước dữ liệu của bạn.

- [1. Nhập từ tài khoản RisuAI](#1-nhập-từ-tài-khoản-risuai) — RisuAI Web có đồng bộ tài khoản. Máy chủ tải dữ liệu tài khoản trực tiếp.
- [2. Tệp sao lưu cục bộ (.bin)](#2-tệp-sao-lưu-cục-bộ-bin) — Hoạt động trong mọi môi trường. Phương pháp phổ biến nhất.
- [3. Tải lên zip thư mục save](#3-tải-lên-zip-thư-mục-save) — RisuAI Cục bộ, dữ liệu nhỏ.
- [4. Sao chép trực tiếp thư mục save](#4-sao-chép-trực-tiếp-thư-mục-save) — RisuAI Cục bộ, dữ liệu lớn.


## Trước khi bắt đầu

> ⚠️ **Sao lưu dữ liệu hiện có** trước khi di chuyển. Bạn có thể xuất tệp `.bin` từ Cài đặt > Sao lưu của RisuAI.


---

## 1. Nhập từ tài khoản RisuAI

Máy chủ PocketRisu tải trực tiếp từ RisuAI dữ liệu được lưu trong tài khoản RisuAI web (risuai.xyz). Nhân vật, cuộc trò chuyện, cài đặt và hình ảnh trong tài khoản sẽ được chuyển sang.

1. **Trên RisuAI web** (nếu chưa dùng đồng bộ tài khoản): đăng nhập ở Cài đặt > Tài khoản & Các tập tin rồi bật "Lưu dữ liệu trong tài khoản". Khi hộp chọn hiện ra, chọn "Lưu dữ liệu hiện tại vào tài khoản" và nhập `RISUAI` vào ô xác nhận. Dữ liệu hiện tại sẽ được tải lên tài khoản.
2. **Trong PocketRisu**: tại Cài đặt > Di chuyển dữ liệu > "Nhập từ tài khoản RisuAI", đồng ý với điều khoản dịch vụ của RisuAI rồi đăng nhập.
3. Kiểm tra số nhân vật, cuộc trò chuyện, hình ảnh và thời gian dự kiến, rồi bấm "Bắt đầu nhập".
4. Cho đến khi xong, PocketRisu chỉ hiển thị màn hình nhập. Khi xong, dữ liệu được thay thế và trang tự tải lại.

> ⚠️ Việc nhập sẽ **thay toàn bộ dữ liệu hiện tại của PocketRisu bằng dữ liệu tài khoản** (không gộp). Nếu có dữ liệu cần giữ, hãy sao lưu trước.

- Để không gây tải cho máy chủ RisuAI, mỗi giây chỉ tải một mục. Nếu có nhiều hình ảnh, việc này có thể mất vài giờ.
- Nếu máy chủ khởi động lại hoặc phiên đăng nhập RisuAI hết hạn, sau khi đăng nhập lại chỉ phần còn lại được tải tiếp.
- Hình ảnh chèn vào cuộc trò chuyện (inlay) chỉ được lưu trong trình duyệt nên không được nhập.
- Dung lượng lưu trữ của tài khoản RisuAI có giới hạn.


---

## 2. Tệp sao lưu cục bộ (.bin)

Xuất tệp sao lưu `.bin` từ RisuAI hiện có, sau đó nhập vào PocketRisu. Hoạt động bất kể môi trường nguồn (web / Tauri / Capacitor / cục bộ).

1. **Trong RisuAI hiện có**: Cài đặt > Sao lưu > "Lưu bản sao lưu cục bộ" để xuất tệp `.bin`.
2. **Trong PocketRisu**: Cài đặt > Di chuyển dữ liệu > "Nhập bản sao lưu cục bộ Risu gốc" để nhập tệp `.bin`.

> ⚠️ **Sự cố tạm thời (tính đến tháng 10/2026)**: Ở phiên bản mới nhất của RisuAI web (risuai.xyz), cơ sở dữ liệu trong tệp tạo bằng "Lưu bản sao lưu cục bộ" luôn được mã hóa, dù bạn có đăng nhập tài khoản hay không. PocketRisu sẽ từ chối tệp này kèm thông báo sao lưu đã mã hóa. (Bản sao lưu tạo từ ứng dụng RisuAI trên máy tính hoặc máy chủ Node tự lưu trữ không bị ảnh hưởng.) Đã có yêu cầu sửa lỗi gửi tới RisuAI ([kwaroran/Risuai#1681](https://github.com/kwaroran/Risuai/issues/1681)). Trong lúc chờ, hãy chuyển dữ liệu qua đồng bộ tài khoản của RisuAI web bằng [1. Nhập từ tài khoản RisuAI](#1-nhập-từ-tài-khoản-risuai).
>
> Nếu bạn vốn đã dùng đồng bộ tài khoản ("Lưu dữ liệu trong tài khoản") trên RisuAI web, bản sao lưu của bạn đã được mã hóa bất kể sự cố này. Khi đó cũng hãy dùng cách 1.



---

## 3. Tải lên zip thư mục save

Nếu bạn đang sử dụng RisuAI Cục bộ (phiên bản máy chủ Node), bạn có thể nén thư mục `save` và tải lên.

1. Nén thư mục `save` của dự án RisuAI hiện có thành tệp zip.
2. Trong PocketRisu, vào Cài đặt > Di chuyển dữ liệu > accordion "Nhập thư mục save từ NodeOnly Risu".
3. Tải lên zip qua "Nhập từ thư mục save (Tải lên Zip)".

> Nếu tệp zip quá lớn, việc tải lên có thể thất bại. Trong trường hợp đó, hãy sử dụng [4. Sao chép trực tiếp thư mục save](#4-sao-chép-trực-tiếp-thư-mục-save).


---

## 4. Sao chép trực tiếp thư mục save

Phù hợp cho dữ liệu lớn (vài GB trở lên). Yêu cầu quyền truy cập trực tiếp hệ thống tệp của máy chủ.

1. Dừng máy chủ PocketRisu.
2. Ghi đè thư mục `save` của PocketRisu bằng thư mục `save` của RisuAI hiện có.
3. Khởi động lại máy chủ PocketRisu — quá trình di chuyển tự động bắt đầu.
    - Theo dõi tiến trình trong terminal hoặc nhật ký PM2.
4. Sau khi hoàn tất di chuyển, sử dụng Cài đặt > Di chuyển dữ liệu > accordion "Nhập thư mục save từ NodeOnly Risu" > "Dọn dẹp tệp save đã di chuyển" để xóa các tệp gốc và thu hồi dung lượng đĩa.


---

## Tôi nên chọn phương pháp nào?

| Tình huống                                                | Phương pháp được đề xuất             |
| --------------------------------------------------------- | ------------------------------------ |
| Di chuyển từ RisuAI Web                                   | 2. Sao lưu `.bin`                    |
| Di chuyển từ RisuAI Web, bản sao lưu bị từ chối vì đã mã hóa | 1. Nhập từ tài khoản RisuAI |
| Di chuyển từ RisuAI Cục bộ, dữ liệu nhỏ                   | 3. Tải lên Zip                       |
| Di chuyển từ RisuAI Cục bộ, dữ liệu lớn (10GB+)           | 4. Sao chép trực tiếp thư mục save   |
| Không chắc                                                | 2. Sao lưu `.bin`                    |


---

← [Quay lại README](../../i18n/README.vi.md)
