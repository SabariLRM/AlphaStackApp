# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mailserver .

FROM alpine:3.22
RUN adduser -D -H -u 10001 smtp
COPY --from=build /out/mailserver /usr/local/bin/mailserver
USER smtp
EXPOSE 2525
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=5 CMD ["mailserver", "-healthcheck"]
ENTRYPOINT ["mailserver"]
