import { User } from '@prisma/client';
import { CustomPrismaClient } from '../../database/prismaConfig';
import {
    IThermometerUpdate,
    IFindUserKeyword,
    IThermometerUser,
    ITopPercentage,
    IUpdateProfile,
    IUserCreateDTO,
    IUserFindOneUserByID,
    ISaveInterestKeyword,
    IScrapping,
    IGetUserScrap,
} from './interfaces/user.interface';
import CustomError from '../../common/error/customError';
import { Service } from 'typedi';
import { ElasitcClient } from '../../database/elasticConfig';
import { scrapData } from '../../common/util/scrap_data';
import { ScrapType } from './types/scrap.type';
import {
    emailProviderType,
    getScrapIdType,
    interestKeywordType,
    userProfileType,
} from '../../common/types';
import { percentage } from '../../common/util/termometer';
import { PercentageType } from './types/thermometer.type';
import { languageTitle } from '../../common/util/languageData';

@Service()
export class UserService {
    constructor(
        private readonly prisma: CustomPrismaClient, //
        private readonly elastic: ElasitcClient,
    ) {}

    async findUserKeyword({
        id,
        path,
        classify,
    }: IFindUserKeyword): Promise<string> {
        const result = await this.prisma.user.findUnique({
            where: {
                id,
            },
            select: {
                interests: {
                    include: {
                        interest: true,
                        keyword: true,
                    },
                },
            },
        });

        let keywords: string[] = [];

        result!.interests.forEach(
            (el) =>
                el.interest.interest === path &&
                keywords.push(el.keyword.keyword),
        );

        if (classify) {
            keywords = await Promise.all(
                keywords.map(async (test) => {
                    return this.elastic
                        .search({
                            index: path,
                            _source: 'test',
                            size: 1,
                            body: {
                                query: {
                                    bool: {
                                        must: [
                                            { match: { classify } },
                                            { match: { test } },
                                        ],
                                    },
                                },
                            },
                        })
                        .then((data) => {
                            const hits = data.body.hits.hits[0];
                            return hits && hits._source.test;
                        });
                }),
            );
        }

        return keywords.filter((el) => el).join(' ');
    }

    saveInterestKeyword({
        prisma,
        interests,
        id,
    }: ISaveInterestKeyword): Promise<void[][]> {
        return Promise.all(
            interests.map(async (el) => {
                const [interest, keywords] = Object.entries(el)[0];
                const createdInterest = await prisma.interest.upsert({
                    where: { interest },
                    update: {},
                    create: { interest },
                });

                return Promise.all(
                    keywords.map(async (keyword: string) => {
                        const createdKeyword = await prisma.keyword.upsert({
                            where: { keyword },
                            update: {},
                            create: { keyword },
                        });
                        await prisma.userInterest.create({
                            data: {
                                userId: id,
                                interestId: createdInterest.id,
                                keywordId: createdKeyword.id,
                            },
                        });
                    }),
                );
            }),
        );
    }

    findOneUserByEmail(email: User['email']): Promise<User | null> {
        return this.prisma.user.findUnique({
            where: {
                email,
            },
            include: {
                interests: {
                    include: {
                        interest: true,
                        keyword: true,
                    },
                },
                communities: true,
            },
        });
    }

    async isUserByID(id: User['id']): Promise<User> {
        const isUser = await this.prisma.user.findUnique({
            where: {
                id,
            },
            include: {
                communities: true,
                interests: true,
            },
        });
        if (!isUser) {
            throw new CustomError('id가 일치하는 유저가 없습니다', 400);
        }
        return isUser;
    }

    async findUserProfile(id: User['id']): Promise<userProfileType> {
        const profile = await this.prisma.user.findUnique({
            where: { id },
            select: {
                email: true,
                profileImage: true,
                nickname: true,
                interests: {
                    select: {
                        interest: { select: { interest: true } },
                        keyword: { select: { keyword: true } },
                    },
                },
            },
        });

        const interestKeyword: interestKeywordType[] = [];
        profile?.interests.map((el) => {
            const { interest, keyword } = el;
            const isInterest = interestKeyword.find(
                (item: interestKeywordType) =>
                    item.interest === interest.interest,
            );

            if (isInterest) isInterest.keyword.push(keyword.keyword);
            else
                interestKeyword.push({
                    interest: interest.interest,
                    keyword: [keyword.keyword],
                });
        });

        return {
            email: profile!.email,
            profileImage: profile!.profileImage,
            nickname: profile!.nickname,
            interestKeyword,
        };
    }

    async isNickname(nickname: User['nickname']): Promise<boolean> {
        const isNickname = await this.prisma.user.findUnique({
            where: {
                nickname,
            },
        });
        if (isNickname)
            throw new CustomError('이미 사용중인 닉네임입니다', 400);
        return true;
    }

    findOneUserByID({
        name,
        phone,
    }: IUserFindOneUserByID): Promise<emailProviderType[]> {
        return this.prisma.user.findMany({
            where: {
                name,
                phone,
            },
            select: {
                email: true,
                provider: true,
            },
        });
    }

    //return type 설정 - 추후에 solution 정리되면
    async getLoginUserInfo(id: User['id']) {
        const user = await this.isUserByID(id).then((el) => {
            const { nickname, profileImage, thermometer, top, subMajorId } = el;
            return { nickname, profileImage, thermometer, top, subMajorId };
        });

        const { subMajorId, ...rest } = user;

        const major = await this.prisma.subMajor.findUnique({
            where: { id: user.subMajorId },
            select: {
                mainMajor: {
                    select: { mainMajor: true },
                },
            },
        });

        return {
            ...rest,
            mainMajor: major!.mainMajor.mainMajor,
        };
    }

    async createUser({ createDTO }: IUserCreateDTO): Promise<User['id']> {
        const { interests, major, ...userData } = createDTO;

        const { mainMajor, subMajor } = major;

        await this.isNickname(userData.nickname);

        return await this.prisma.$transaction(async (prisma) => {
            const isSubMajor = await prisma.subMajor.findFirst({
                where: { AND: [{ subMajor, mainMajor: { mainMajor } }] },
                select: { id: true },
            });
            const subMajorId = isSubMajor
                ? isSubMajor
                : await prisma.subMajor.create({
                      data: {
                          subMajor,
                          mainMajor: {
                              connectOrCreate: {
                                  where: { mainMajor },
                                  create: { mainMajor },
                              },
                          },
                      },
                      select: { id: true },
                  });

            const user = await prisma.user.create({
                data: {
                    ...userData,
                    subMajorId: subMajorId.id,
                },
            });
            await this.saveInterestKeyword({
                prisma,
                interests,
                id: user.id,
            });
            return user.id;
        });
    }

    async updateProfile({ id, updateDTO }: IUpdateProfile): Promise<User> {
        const { interests, ...data } = updateDTO;

        const chkUser = await this.isUserByID(id);

        data.nickname && (await this.isNickname(data.nickname));

        if (interests) {
            await this.prisma.userInterest.deleteMany({
                where: { userId: id },
            });

            await this.prisma
                .$transaction(async (prisma) => {
                    await this.saveInterestKeyword({
                        prisma,
                        interests,
                        id: chkUser.id,
                    });
                })
                .then(async () => await this.isUserByID(id));
        }

        return await this.prisma.user.update({
            where: { id },
            data,
            include: {
                interests: {
                    include: {
                        interest: true,
                        keyword: true,
                    },
                },
            },
        });
    }

    async scrapping({ id, scrappingDTO }: IScrapping): Promise<boolean> {
        await this.isUserByID(id);
        const { path, scrapId } = scrappingDTO;
        const { column, id: _scrapId } = scrapData(path);

        const chkScrap = await this.prisma.user.findFirst({
            include: {
                [column]: {
                    where: {
                        AND: [{ userId: id, [_scrapId]: scrapId }],
                    },
                },
            },
        });

        const chkPlusMinus = chkScrap?.[column].length;
        const plusMinus = `ctx._source.scrap${chkPlusMinus ? '--' : '++'}`;

        await Promise.all([
            this.elastic
                .update(
                    {
                        index: path,
                        id: scrapId,
                        body: {
                            script: {
                                source: plusMinus,
                            },
                        },
                    },
                    { ignore: [404] },
                )
                .then((el) => el.body.error && el.meta.context),

            this.prisma.user.update({
                where: { id },
                data: {
                    [column]: chkPlusMinus
                        ? {
                              deleteMany: { [_scrapId]: scrapId },
                          }
                        : { create: { [_scrapId]: scrapId } },
                },
            }),
        ]);

        return chkPlusMinus ? false : true;
    }

    async getUserScrap({
        id,
        getUserScrapDTO,
    }: IGetUserScrap): Promise<ScrapType[]> {
        const { path, count, page } = getUserScrapDTO;
        await this.isUserByID(id);

        const _id = await this.getScrapId({ id, path });

        return await this.elastic
            .search({
                index: path,
                _source_includes: scrapData(path).info,
                body: {
                    sort:
                        path === 'language'
                            ? [
                                  {
                                      sortDate: {
                                          order: 'asc',
                                      },
                                  },
                              ]
                            : [{ view: { order: 'desc' } }],
                    query: {
                        terms: {
                            _id,
                        },
                    },
                    ...(page && { size: 4, from: (+page - 1 || 0) * 4 }),
                },
            })
            .then((data) => {
                return count
                    ? data.body.hits.total.value
                    : data.body.hits.hits.length
                    ? data.body.hits.hits.map((el: any) => {
                          if (path === 'language') {
                              const { test, ...data } = el._source;
                              return {
                                  id: el._id,
                                  enterprise: 'YBM',
                                  ...data,
                                  title: languageTitle(test),
                              };
                          }
                          if (path === 'qnet') {
                              const schedule = el._source.examSchedules[0];
                              delete el._source.examSchedules;
                              return {
                                  mainImage: process.env.QNET_IMAGE,
                                  id: el._id,
                                  period: schedule.wtPeriod,
                                  examDate: schedule.wtDday,
                                  ...el._source,
                              };
                          }
                          return {
                              id: el._id,
                              ...el._source,
                          };
                      })
                    : null;
            });
    }

    async getScrapId({ id, path }: getScrapIdType): Promise<string[]> {
        return await this.prisma.user
            .findUnique({
                where: { id },
                include: {
                    [scrapData(path).column]: true,
                },
            })
            .then((data) =>
                data![scrapData(path).column].map(
                    (el: any) => el[scrapData(path).id],
                ),
            );
    }

    async delete(email: User['email']): Promise<boolean> {
        const user = await this.findOneUserByEmail(email);
        const qqq = await this.prisma.user.delete({ where: { id: user?.id } });
        console.log(qqq);
        return true;
    }

    async updateThermometer({
        id,
        path,
        createThermometer,
        mainMajorId,
        thermometerId,
    }: IThermometerUpdate): Promise<boolean> {
        await this.isUserByID(id);

        const obj = {
            outside: 'userOutside',
            intern: 'userIntern',
            competition: 'userCompetition',
            language: 'userLanguage',
            qnet: 'userQnet',
        };

        await this.prisma.user.update({
            where: { id },
            data: {
                [obj[path]]: createThermometer
                    ? { create: { ...createThermometer } }
                    : { delete: { id: thermometerId } },
            },
        });
        const { sum: thermometer } = await this.getCount(id);
        await this.prisma.user.update({
            where: { id },
            data: {
                thermometer,
            },
        });

        await this.topPercent({ id, mainMajorId });

        return true;
    }

    async getCount(id: string): Promise<PercentageType> {
        await this.isUserByID(id);

        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                userCompetition: {
                    select: {
                        id: true,
                    },
                },
                userOutside: {
                    select: {
                        id: true,
                    },
                },
                userQnet: {
                    select: {
                        id: true,
                    },
                },
                userIntern: {
                    select: {
                        id: true,
                    },
                },
                userLanguage: {
                    select: {
                        id: true,
                    },
                },
            },
        });
        return percentage(user as IThermometerUser);
    }

    async topPercent({ id, mainMajorId }: ITopPercentage): Promise<User> {
        const users = await this.prisma.user.findMany({
            where: {
                subMajor: {
                    mainMajorId,
                },
            },
            select: {
                id: true,
            },
            orderBy: {
                thermometer: 'desc',
            },
        });

        const grade = users.findIndex((el) => el.id === id) + 1;

        await Promise.all(
            users.map(async (el, index) => {
                const { id } = el;
                const grade = index + 1;
                const top = (grade / users.length) * 100;
                return this.prisma.user.update({
                    where: { id },
                    data: { top },
                });
            }),
        );

        const top = (grade / users.length) * 100;

        return this.prisma.user.update({
            where: { id },
            data: {
                top,
            },
        });
    }
}
