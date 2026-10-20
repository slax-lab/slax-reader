import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({plugins:[vue()],clearScreen:false,server:{host:'127.0.0.1',port:1420,strictPort:true},build:{target:'safari17',sourcemap:false},worker:{format:'es'}})
