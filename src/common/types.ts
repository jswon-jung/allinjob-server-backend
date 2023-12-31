import { Provider, User } from '@prisma/client';
import { CreateUserDTO } from '../apis/users/dto/create-user.dto';
import { Path, paths } from './crawiling/interface';
import { CustomPrismaClient } from '../database/prismaConfig';
import { UpdateUserDTO } from '../apis/users/dto/update-user.dto';

export type email = {
    email: CreateUserDTO['email'];
};

export type providerTokenType = {
    provider: string;
    token: string;
};

export type getScrapIdType = {
    id: User['id'];
    path: paths['path'];
};

export type idType = {
    id: User['id'];
};

export type yearMonthType = {
    year: string;
    month: string;
};

export type pathPageCountType = {
    path: Path['path'] | 'language';
    count?: string;
    page?: string;
};

export type phoneType = {
    phone: CreateUserDTO['phone'];
};

export type createDTOType = CreateUserDTO;

export type updateDTOType = UpdateUserDTO;

export type validateTokenType = {
    token: number;
    phone: CreateUserDTO['phone'];
};

export type interestKeywordType = {
    interest: string;
    keyword: string[];
};

export type userProfileType = {
    email: User['email'];
    profileImage: User['profileImage'];
    nickname: User['nickname'];
    interestKeyword: interestKeywordType[];
};

export type pathIdtype = {
    path: Path['path'] | 'language';
    scrapId: string;
};

export type pathType = {
    path: string;
};

export type categoryType = {
    category: string;
};

export type classifyType = {
    classify: string;
};

export type findOneUserByIDType = {
    name: CreateUserDTO['name'];
    phone: CreateUserDTO['phone'];
};

export type nicknameType = {
    nickname: CreateUserDTO['nickname'];
};

export type authorization = {
    authorization: string;
};

export type cookie = {
    cookie: string;
};

export type emailProviderType = {
    email: CreateUserDTO['email'];
    provider: Provider;
};
