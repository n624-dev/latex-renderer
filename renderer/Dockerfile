FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241

ARG TEXLIVE_REPOSITORY=https://texlive.info/tlnet-archive/2026/08/12/tlnet
ARG TEXLIVE_INSTALLER_SHA512=f59a83d71f4d4cd6a1265fa7984fa20f5a9204382e1365b01f3034617243a3388d3fb681035ebe5026e32fcdb3839e2a8643aed7c52e08394b030f7119dd233e
ARG TEXLIVE_KEY_FINGERPRINT=C78B82D8C79512F79CC0D7C80D5E5D9106BAB6BC
ARG TEXLIVE_PROFILE_KIND=legacy-custom
ARG DEBIAN_SNAPSHOT=20260812T235959Z

LABEL org.opencontainers.image.title="latex-renderer-texlive" \
      org.opencontainers.image.version="2026" \
      org.opencontainers.image.source="https://github.com/n624-dev/latex-renderer" \
      org.opencontainers.image.description="Sandboxed TeX Live 2026 renderer base" \
      jp.n624.latex-renderer.texlive.repository="${TEXLIVE_REPOSITORY}" \
      jp.n624.latex-renderer.texlive.installer-sha512="${TEXLIVE_INSTALLER_SHA512}" \
      jp.n624.latex-renderer.texlive.profile-kind="${TEXLIVE_PROFILE_KIND}" \
      jp.n624.latex-renderer.debian.snapshot="${DEBIAN_SNAPSHOT}"

ARG DEBIAN_FRONTEND=noninteractive
RUN set -eu; \
    case "${DEBIAN_SNAPSHOT}" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z) ;; *) exit 64 ;; esac; \
    printf '%s\n' \
      "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/ bookworm main" \
      "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}/ bookworm-security main" \
      > /etc/apt/sources.list; \
    rm -f /etc/apt/sources.list.d/debian.sources; \
    apt-get -o Acquire::Check-Valid-Until=false update; \
    apt-get install -y --no-install-recommends ca-certificates; \
    sed -i 's|http://snapshot.debian.org/|https://snapshot.debian.org/|g' /etc/apt/sources.list; \
    apt-get -o Acquire::Check-Valid-Until=false update; \
    mkdir -p /opt/renderer; \
    apt-get install -y --no-install-recommends \
      ca-certificates curl fontconfig gnupg gpgv imagemagick libfontconfig1 perl poppler-utils qpdf tar xz-utils; \
    dpkg-query -W -f='${binary:Package}\t${Version}\n' | LC_ALL=C sort > /opt/renderer/debian-packages.txt; \
    rm -rf /var/lib/apt/lists/*

COPY texlive.profile /tmp/texlive.profile
RUN mkdir -p /tmp/install-tl \
 && curl --fail --location --retry 5 --retry-delay 1 --connect-timeout 15 --max-time 600 --output /tmp/install-tl-unx.tar.gz "${TEXLIVE_REPOSITORY}/install-tl-unx.tar.gz" \
 && curl --fail --location --retry 5 --retry-delay 1 --connect-timeout 15 --max-time 120 --output /tmp/install-tl.tar.gz.sha512 "${TEXLIVE_REPOSITORY}/install-tl-unx.tar.gz.sha512" \
 && curl --fail --location --retry 5 --retry-delay 1 --connect-timeout 15 --max-time 120 --output /tmp/install-tl.tar.gz.sha512.asc "${TEXLIVE_REPOSITORY}/install-tl-unx.tar.gz.sha512.asc" \
 && curl --fail --location --retry 5 --retry-delay 1 --connect-timeout 15 --max-time 120 --output /tmp/texlive.asc "https://keys.openpgp.org/vks/v1/by-fingerprint/${TEXLIVE_KEY_FINGERPRINT}" \
 && test "$(gpg --batch --show-keys --with-colons /tmp/texlive.asc 2>/dev/null | awk -F: '$1=="fpr" {print $10; exit}')" = "${TEXLIVE_KEY_FINGERPRINT}" \
 && gpg --batch --yes --dearmor --output /tmp/texlive.gpg /tmp/texlive.asc \
 && echo "${TEXLIVE_INSTALLER_SHA512}  /tmp/install-tl-unx.tar.gz" | sha512sum --check --strict \
 && gpgv --keyring /tmp/texlive.gpg /tmp/install-tl.tar.gz.sha512.asc /tmp/install-tl.tar.gz.sha512 \
 && (cd /tmp && sha512sum --check --strict install-tl.tar.gz.sha512) \
 && tar -xzf /tmp/install-tl-unx.tar.gz --strip-components=1 -C /tmp/install-tl \
 && perl /tmp/install-tl/install-tl --profile=/tmp/texlive.profile --repository="${TEXLIVE_REPOSITORY}" \
 && rm -rf /tmp/install-tl /tmp/install-tl-unx.tar.gz /tmp/install-tl.tar.gz.sha512* /tmp/texlive.asc /tmp/texlive.gpg /tmp/texlive.profile /opt/texlive/2026/tlpkg/backups

ENV PATH="/opt/texlive/2026/bin/x86_64-linux:${PATH}"
RUN fc-cache -f \
 && TEXMFCACHE=/opt/texlive/2026/texmf-var luaotfload-tool --update --force --no-compress
COPY texmf.cnf latexmkrc compile.sh svg-wrapper.tex export-svg.pl /opt/renderer/
RUN chmod 0555 /opt/renderer/compile.sh /opt/renderer/export-svg.pl \
 && chmod 0444 /opt/renderer/texmf.cnf /opt/renderer/latexmkrc /opt/renderer/svg-wrapper.tex \
 && chmod 0444 /opt/renderer/debian-packages.txt \
 && printf '{"texliveRepository":"%s","installerSha512":"%s","profileKind":"%s","debianSnapshot":"%s"}\n' "${TEXLIVE_REPOSITORY}" "${TEXLIVE_INSTALLER_SHA512}" "${TEXLIVE_PROFILE_KIND}" "${DEBIAN_SNAPSHOT}" > /opt/renderer/build-provenance.json \
 && chmod 0444 /opt/renderer/build-provenance.json \
 && if [ "${TEXLIVE_PROFILE_KIND}" = "language-neutral-maximal" ]; then \
      rm -f /opt/renderer/compile.sh /opt/renderer/export-svg.pl /opt/renderer/texmf.cnf /opt/renderer/latexmkrc /opt/renderer/svg-wrapper.tex; \
    fi \
 && mkdir -p /work/input /work/output \
 && chown -R 10000:10000 /work

USER 10000:10000
WORKDIR /work/input
ENTRYPOINT ["/opt/renderer/compile.sh"]
