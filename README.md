# Деплой проекта (generals.mak-o.ru)

Инструкция по развертыванию приложения на сервере (Linux) с использованием PM2, Caddy и проксированием через Cloudflare.

## 1. Настройка Cloudflare DNS
1. Зайдите в панель управления Cloudflare.
2. Откройте настройки DNS вашего домена (`mak-o.ru`).
3. Создайте новую `A` запись:
   * **Name**: `generals`
   * **IPv4 address**: Укажите IP-адрес вашего сервера (VPS/VDS).
   * **Proxy status**: Включен (Оранжевое облако ☁️).
4. В разделе **SSL/TLS -> Overview** установите режим шифрования на **Full (Strict)** или **Full**. Это важно, чтобы избежать ошибки циклической переадресации (Too Many Redirects).

## 2. Подготовка сервера и запуск проекта
> ⚠️ **ВАЖНОЕ ТРЕБОВАНИЕ**: Для сборки проекта строго необходим **Node.js версии 20.0.0 или новее** (рекомендуются стабильные LTS-версии v20 или v22). На версиях ниже (например, v18) современный компилятор Tailwind CSS (`@tailwindcss/oxide`) и плагин Vite выдадут ошибку отсутствия нативных биндингов.

### Как быстро обновить Node.js на сервере до v20 (через NVM):
Рекомендуется устанавливать Node.js через **Node Version Manager (NVM)** — это самый простой и безопасный способ:
1. Установите NVM:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   # Перезапустите сессию терминала или выполните:
   source ~/.bashrc
   ```
2. Установите стабильную LTS-версию Node.js v20:
   ```bash
   nvm install 20
   nvm use 20
   nvm alias default 20
   ```
3. Убедитесь, что версия обновилась:
   ```bash
   node -v
   # Должно вывести v20.x.x
   ```

---

### Пошаговый запуск проекта после обновления Node.js:
1. Скопируйте файлы проекта на сервер (например, в директорию `/srv/generals`).
2. Перейдите в папку с проектом:
   ```bash
   cd /srv/generals
   ```
3. Очистите старые несовместимые сборки (это обязательно, так как биндинги v18 не подойдут для v20):
   ```bash
   rm -rf node_modules package-lock.json
   ```
4. Установите все зависимости проекта:
   ```bash
   npm install
   ```
5. Соберите проект:
   ```bash
   npm run build
   ```
6. **Решение проблемы "Command 'pm2' not found"**:
   Так как вы переключились на новую версию Node.js через NVM, глобальные пакеты остались на старой версии Node. Вам нужно заново установить `pm2` для текущей активной версии Node.js v20:
   ```bash
   # Выполните установку:
   npm install -g pm2
   
   # Если терминал всё ещё не видит команду pm2, обновите пути:
   source ~/.bashrc
   ```
   *Альтернативный вариант (если не хочется ставить глобально):* вы можете вызывать PM2 через встроенный npx:
   ```bash
   npx pm2 start npm --name "generals-app" -- start
   ```

7. Запустите приложение через PM2 (с явным указанием Production режима):
   ```bash
   npx pm2 start npm --name "generals-app" -- start
   ```
   *Опционально:* чтобы приложение автоматически запускалось после перезагрузки сервера:
   ```bash
   pm2 startup
   pm2 save
   ```
*(Теперь приложение работает локально на сервере и слушает порт `3000`)*

## 3. Настройка Caddy под оранжевое облако Cloudflare (Проксирование)
При включенном проксировании (оранжевое облако ☁️), Cloudflare сам предоставляет SSL-сертификат вашим пользователям. Для взаимодействия Cloudflare с вашим сервером (Caddy → Node.js) есть 3 стандартных сценария. Выберите **один** наиболее подходящий вариант:

---

### Вариант А: Использовать SSL от Cloudflare на шифровании Flexible (Просто и быстро)
В этом режиме трафик от пользователя до Cloudflare зашифрован (HTTPS), а от Cloudflare до вашего сервера идет незашифрованным (HTTP на порт 80). Caddy работает без настройки сертификатов.

1. В Cloudflare в разделе **SSL/TLS -> Overview** переключите режим на **Flexible**.
2. Измените `/etc/caddy/Caddyfile` следующим образом:
   ```caddyfile
   http://generals.mak-o.ru {
       reverse_proxy localhost:3000
   }
   ```
3. Перезапустите Caddy:
   ```bash
   sudo systemctl restart caddy
   ```

---

### Вариант Б: Использовать Origin CA Certificate от Cloudflare (Максимальная безопасность)
Это самый надежный профессиональный подход. Вы скачиваете бесплатный доверенный сертификат прямо из панели Cloudflare, а на сервере Caddy использует его. Это позволяет включить режим **Full (Strict)**.

1. Зайдите в панель Cloudflare -> **SSL/TLS -> Origin Server**.
2. Нажмите **Create Certificate**, оставьте настройки по умолчанию (RSA 2048, действителен 15 лет) и нажмите **Create**.
3. Скопируйте содержимое **Origin Certificate** в файл `/etc/caddy/certs/generals.pem`, а **Private Key** в файл `/etc/caddy/certs/generals.key` на вашем сервере:
   ```bash
   sudo mkdir -p /etc/caddy/certs
   sudo nano /etc/caddy/certs/generals.pem  # Вставьте сюда сертификат
   sudo nano /etc/caddy/certs/generals.key  # Вставьте сюда приватный ключ
   ```
4. В `/etc/caddy/Caddyfile` пропишите:
   ```caddyfile
   generals.mak-o.ru {
       tls /etc/caddy/certs/generals.pem /etc/caddy/certs/generals.key
       reverse_proxy localhost:3000
   }
   ```
5. В панели Cloudflare в разделе **SSL/TLS -> Overview** установите режим **Full (Strict)**.
6. Перезапустите Caddy:
   ```bash
   sudo systemctl restart caddy
   ```

---

### Вариант В: Использовать встроенный самоподписанный SSL от Caddy (Шифрование Full)
Caddy может сам сгенерировать локальный сертификат. Cloudflare будет доверять ему в режиме **Full** (но не Strict).

1. В Cloudflare в разделе **SSL/TLS -> Overview** установите режим **Full** (не Strict!).
2. В `/etc/caddy/Caddyfile` пропишите:
   ```caddyfile
   generals.mak-o.ru {
       tls internal
       reverse_proxy localhost:3000
   }
   ```
3. Перезапустите Caddy:
   ```bash
   sudo systemctl restart caddy
   ```

## Готово!
Через несколько минут (когда обновятся DNS от Cloudflare) проект будет доступен по адресу: `https://generals.mak-o.ru`.
