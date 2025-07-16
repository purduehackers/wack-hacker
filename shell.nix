let
    pkgs = import <nixpkgs> {};
in
pkgs.mkShell {
    buildInputs = with pkgs; [
          bun
          corepack_latest
          nodejs_latest
          eslint
    ];
    }
